import { Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { ageFromBirthDate, localCalendarDate } from "@sellpoint/shared";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import type { RequestMeta } from "../auth/auth.service";
import type { AuthUser } from "../auth/types/auth-user";
import { CustomersService } from "../reception/customers.service";
import type { CreateCustomerDto } from "../reception/dto/upsert-customer.dto";
import type { SearchPatientsQuery } from "./dto/search-patients.dto";

export interface PatientHit {
  customerId: string;
  name: string;
  age: number | null;
  birthDate: string | null;
  turnNumber: number | null;
  lastRecord: { id: string; folio: string; consultationDate: string } | null;
}

/**
 * F9-CLINIC-09 — el paciente ES el cliente de Recepción (`customers`): no hay
 * una segunda tabla de personas. Por nombre se reusa `CustomersService.list`
 * (una sola verdad de búsqueda); por turno se mira `reception_turns` del DÍA
 * DEL NEGOCIO de hoy — el turno 5 de ayer no es el 5 de hoy — y se exige que
 * tenga paciente. «Paciente nuevo» delega en el alta de Recepción: audita
 * como `reception.customer.create`, porque es exactamente eso.
 */
@Injectable()
export class PatientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly customers: CustomersService,
  ) {}

  async search(user: AuthUser, query: SearchPatientsQuery): Promise<PatientHit[]> {
    if (query.mode === "name") {
      const { rows } = await this.customers.list(user, { query: query.q, page: 1, pageSize: 20 });
      const ultimos = await this.ultimosExpedientes(
        user.tenantId,
        rows.map((r) => r.id),
      );
      return rows.map((r) => ({
        customerId: r.id,
        name: nombreCompleto(r),
        age: r.age,
        birthDate: r.birthDate,
        turnNumber: null,
        lastRecord: ultimos.get(r.id) ?? null,
      }));
    }

    const zona = await this.zonaDelNegocio(user.tenantId);
    const hoy = localCalendarDate(zona, new Date());
    const numero = Number(query.q);
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const turno = await tx.receptionTurn.findFirst({
        // `YYYY-MM-DD` parseado en UTC: justo lo que la columna DATE compara.
        where: { tenantId: user.tenantId, businessDate: new Date(hoy), number: numero },
        select: { id: true, number: true, customerId: true },
      });
      if (turno === null) {
        throw new NotFoundException({ message: "medical_clinic.turn_not_found" });
      }
      if (turno.customerId === null) {
        throw new UnprocessableEntityException({ message: "medical_clinic.turn_without_patient" });
      }
      const cliente = await tx.customer.findFirst({
        where: { id: turno.customerId, tenantId: user.tenantId },
        select: {
          id: true,
          firstName: true,
          lastNamePaternal: true,
          lastNameMaternal: true,
          birthDate: true,
        },
      });
      if (cliente === null) {
        throw new NotFoundException({ message: "medical_clinic.patient_not_found" });
      }
      const nacimiento = cliente.birthDate?.toISOString().slice(0, 10) ?? null;
      const ultimos = await this.ultimosExpedientes(user.tenantId, [cliente.id], tx);
      return [
        {
          customerId: cliente.id,
          name: nombreCompleto(cliente),
          age: nacimiento === null ? null : ageFromBirthDate(nacimiento, hoy),
          birthDate: nacimiento,
          turnNumber: turno.number,
          lastRecord: ultimos.get(cliente.id) ?? null,
        },
      ];
    });
  }

  async create(user: AuthUser, input: CreateCustomerDto, meta: RequestMeta) {
    return this.customers.create(user, input, meta);
  }

  /** El último expediente de cada paciente, en una consulta. */
  private async ultimosExpedientes(
    tenantId: string,
    customerIds: string[],
    tx?: Parameters<Parameters<PrismaService["withTenantContext"]>[1]>[0],
  ): Promise<Map<string, { id: string; folio: string; consultationDate: string }>> {
    if (customerIds.length === 0) {
      return new Map();
    }
    const leer = (t: NonNullable<typeof tx>) =>
      t.medicalClinicRecord.findMany({
        where: { tenantId, patientCustomerId: { in: customerIds } },
        orderBy: [{ createdAt: "desc" }],
        select: { patientCustomerId: true, id: true, folio: true, consultationDate: true },
      });
    const filas = tx ? await leer(tx) : await this.prisma.withTenantContext(tenantId, leer);
    const mapa = new Map<string, { id: string; folio: string; consultationDate: string }>();
    for (const fila of filas) {
      if (fila.patientCustomerId !== null && !mapa.has(fila.patientCustomerId)) {
        mapa.set(fila.patientCustomerId, {
          id: fila.id,
          folio: fila.folio,
          consultationDate: fila.consultationDate.toISOString().slice(0, 10),
        });
      }
    }
    return mapa;
  }

  private async zonaDelNegocio(tenantId: string): Promise<string> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { timezone: true },
    });
    return tenant?.timezone ?? "UTC";
  }
}

function nombreCompleto(p: {
  firstName: string;
  lastNamePaternal: string;
  lastNameMaternal: string | null;
}): string {
  return [p.firstName, p.lastNamePaternal, p.lastNameMaternal].filter(Boolean).join(" ");
}
