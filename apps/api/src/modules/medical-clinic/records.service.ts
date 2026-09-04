import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import {
  ageFromBirthDate,
  localCalendarDate,
  MEDICAL_CLINIC_FOLIO_PREFIXES,
  MEDICAL_RECORD_SECTIONS,
  type MedicalRecordLockReason,
  type MedicalRecordSectionGroup,
  medicalRecordLock,
} from "@sellpoint/shared";
import type { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import type { RequestMeta } from "../auth/auth.service";
import type { AuthUser } from "../auth/types/auth-user";
import { nextFolio } from "../inventory/folio";
import { diaDelNegocio } from "./business-day";
import type { CreateRecordDto, ListRecordsQuery } from "./dto/records.dto";
import { isUniqueViolation } from "./study-catalog.service";

export type SectionStatus = "pending" | "completed";

export interface RecordSectionView {
  key: string;
  group: MedicalRecordSectionGroup;
  order: number;
  functional: boolean;
  status: SectionStatus;
  data: Record<string, unknown> | null;
  updatedAt: string | null;
}

export interface RecordOrderView {
  id: string;
  kind: string;
  folio: string;
  status: string;
  quoteId: string | null;
  createdAt: string;
}

export interface RecordDetail {
  id: string;
  folio: string;
  status: "open" | "closed";
  /** ¿Acepta captura? Lo decide el API con el día del NEGOCIO, nunca el web. */
  editable: boolean;
  lockReason: MedicalRecordLockReason | null;
  consultationDate: string;
  closedAt: string | null;
  turnNumber: number | null;
  patient: {
    customerId: string | null;
    name: string;
    birthDate: string | null;
    sex: string | null;
    /** Años cumplidos el DÍA DE LA CONSULTA, no hoy. */
    age: number | null;
  };
  doctor: { id: string; name: string };
  sections: RecordSectionView[];
  orders: RecordOrderView[];
  createdAt: string;
}

export interface RecordSummary {
  id: string;
  folio: string;
  status: string;
  editable: boolean;
  lockReason: MedicalRecordLockReason | null;
  consultationDate: string;
  patientName: string;
  doctorName: string;
  createdAt: string;
}

const INCLUDE = {
  doctor: { select: { id: true, firstName: true, lastNamePaternal: true } },
  sections: true,
  orders: { orderBy: { createdAt: "asc" as const } },
} as const;

type Tx = Parameters<Parameters<PrismaService["withTenantContext"]>[1]>[0];
type RecordRow = Prisma.MedicalClinicRecordGetPayload<{ include: typeof INCLUDE }>;

/**
 * F9-CLINIC-10/12 — la historia clínica: UN expediente por VISITA.
 *
 * Al abrir uno, se copia la fila de Datos Generales del expediente ANTERIOR
 * del mismo paciente (decisión de Carlos, 2026-09-03) y se proyecta su sexo
 * al encabezado. El resto de las secciones nace vacío: cada consulta cuenta
 * su propio motivo y su propio padecimiento.
 *
 * El estado de las 32 secciones se DERIVA: existe fila ⇔ Completado. No hay
 * columna que se pueda desincronizar de su propia tabla.
 */
@Injectable()
export class RecordsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async create(user: AuthUser, input: CreateRecordDto, meta: RequestMeta): Promise<RecordDetail> {
    const zona = await this.zonaDelNegocio(user.tenantId);
    // UN solo instante: el día del negocio de la consulta.
    const hoy = localCalendarDate(zona, new Date());

    try {
      return await this.abrir(user, input, meta, hoy);
    } catch (error) {
      // El cinturón: si el UNIQUE parcial ganó la carrera, la transacción ya
      // está abortada y hay que releer el abierto en una NUEVA para poder
      // decir a qué folio ir.
      if (!isUniqueViolation(error)) {
        throw error;
      }
      const abierta = await this.prisma.withTenantContext(user.tenantId, (tx) =>
        tx.medicalClinicRecord.findFirst({
          where: {
            tenantId: user.tenantId,
            patientCustomerId: input.customerId,
            status: "open",
            consultationDate: new Date(hoy),
          },
          select: { id: true, folio: true },
        }),
      );
      throw new ConflictException({
        message: "medical_clinic.record_open_today",
        recordId: abierta?.id ?? null,
        folio: abierta?.folio ?? null,
      });
    }
  }

  private async abrir(
    user: AuthUser,
    input: CreateRecordDto,
    meta: RequestMeta,
    hoy: string,
  ): Promise<RecordDetail> {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const paciente = await tx.customer.findFirst({
        where: { id: input.customerId, tenantId: user.tenantId },
        select: {
          id: true,
          firstName: true,
          lastNamePaternal: true,
          lastNameMaternal: true,
          birthDate: true,
        },
      });
      if (paciente === null) {
        throw new NotFoundException({ message: "medical_clinic.patient_not_found" });
      }

      let turno: {
        id: string;
        number: number;
        customerId: string | null;
        status: string;
      } | null = null;
      if (input.turnId !== undefined) {
        turno = await tx.receptionTurn.findFirst({
          where: { id: input.turnId, tenantId: user.tenantId },
          select: { id: true, number: true, customerId: true, status: true },
        });
        if (turno === null) {
          throw new NotFoundException({ message: "medical_clinic.turn_not_found" });
        }
      }

      // ── Una consulta abierta por paciente y día (F9-CLINIC-27) ─────────
      //
      // El folio se pide ANTES de mirar a propósito: `nextFolio` bloquea la
      // fila de la serie hasta el COMMIT, así que dos médicos que abren a la
      // vez se serializan y el segundo ya ve la consulta del primero. Si se
      // consultara antes, ambos pasarían el chequeo y nacerían dos folios.
      // El número que gasta el perdedor se deshace con su transacción.
      const folio = await nextFolio(
        tx,
        user.tenantId,
        "medical_record",
        MEDICAL_CLINIC_FOLIO_PREFIXES.record,
      );
      const abierta = await tx.medicalClinicRecord.findFirst({
        where: {
          tenantId: user.tenantId,
          patientCustomerId: paciente.id,
          status: "open",
          consultationDate: new Date(hoy),
        },
        select: { id: true, folio: true },
      });
      if (abierta !== null) {
        // El folio viaja en el cuerpo: la pantalla lleva al médico a esa
        // consulta en vez de dejarlo con un error sin salida.
        throw new ConflictException({
          message: "medical_clinic.record_open_today",
          recordId: abierta.id,
          folio: abierta.folio,
        });
      }

      // ── Copy-forward: SOLO Datos Generales del expediente anterior ──────
      const anterior = await tx.medicalClinicRecord.findFirst({
        where: { tenantId: user.tenantId, patientCustomerId: paciente.id },
        orderBy: [{ createdAt: "desc" }],
        include: { sections: { where: { sectionKey: "general_data" } } },
      });
      const generales = anterior?.sections.find((s) => s.sectionKey === "general_data") ?? null;
      const datosGenerales =
        generales !== null && typeof generales.data === "object" && generales.data !== null
          ? (generales.data as Record<string, unknown>)
          : null;
      const sexo = typeof datosGenerales?.sex === "string" ? datosGenerales.sex : null;

      const creado = await tx.medicalClinicRecord.create({
        data: {
          tenantId: user.tenantId,
          folio,
          patientCustomerId: paciente.id,
          patientName: nombreCompleto(paciente),
          patientBirthDate: paciente.birthDate,
          patientSex: sexo,
          ...(turno !== null && { turnId: turno.id, turnNumber: turno.number }),
          doctorUserId: user.userId,
          // `YYYY-MM-DD` en UTC: justo lo que la columna DATE guarda.
          consultationDate: new Date(hoy),
        },
      });
      if (datosGenerales !== null) {
        await tx.medicalClinicRecordSection.create({
          data: {
            tenantId: user.tenantId,
            recordId: creado.id,
            sectionKey: "general_data",
            data: datosGenerales as Prisma.InputJsonObject,
            updatedBy: user.userId,
          },
        });
      }
      // Iniciar la consulta ES atender el turno: dejarlo «En espera» con el
      // paciente adentro obliga a marcarlo a mano y la pantalla de turnos
      // miente (Carlos, 2026-09-04).
      //
      // Son DOS cosas con condiciones distintas, y confundirlas costó un bug:
      // marcarlo atendido solo aplica si estaba esperando (así no se pisa la
      // hora de quien ya lo atendió), pero LIGAR al paciente aplica siempre
      // que falte — un turno que la recepcionista ya marcó al pasarlo al
      // consultorio se quedaba para siempre diciendo «Sin cliente».
      //
      // Y ligar son DOS columnas, no una: la lista de Recepción pinta el
      // snapshot `customerName` (el que sobrevive a un borrado del cliente),
      // no el cliente vinculado. Escribir solo el id deja la pantalla
      // diciendo «Sin cliente» con el paciente ya adentro — se ve igual de
      // roto que antes, y por eso van juntas como en `TurnsService.create`.
      if (turno !== null) {
        await tx.receptionTurn.updateMany({
          where: { id: turno.id, tenantId: user.tenantId },
          data: {
            ...(turno.status === "waiting" && {
              status: "attended",
              attendedAt: new Date(),
              attendedBy: user.userId,
            }),
            ...(turno.customerId === null && {
              customerId: paciente.id,
              customerName: nombreCompleto(paciente).slice(0, 200),
            }),
          },
        });
      }

      await this.auditService.record(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: "medical_clinic.record.create",
        resourceType: "medical_record",
        resourceId: creado.id,
        after: {
          folio,
          patientCustomerId: paciente.id,
          copiedGeneralDataFrom: anterior?.folio ?? null,
        },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return this.cargar(tx, user.tenantId, creado.id, hoy);
    });
  }

  async list(
    user: AuthUser,
    query: ListRecordsQuery,
  ): Promise<{ rows: RecordSummary[]; total: number; page: number; pageSize: number }> {
    const { page, pageSize } = query;
    const where = {
      tenantId: user.tenantId,
      ...(query.customerId !== undefined && { patientCustomerId: query.customerId }),
    };
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const hoy = await diaDelNegocio(tx, user.tenantId);
      const [total, rows] = await Promise.all([
        tx.medicalClinicRecord.count({ where }),
        tx.medicalClinicRecord.findMany({
          where,
          include: INCLUDE,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
      ]);
      return {
        rows: rows.map((r) => ({
          id: r.id,
          folio: r.folio,
          status: r.status,
          editable:
            medicalRecordLock(
              { status: r.status, consultationDate: fecha(r.consultationDate) },
              hoy,
            ) === null,
          lockReason: medicalRecordLock(
            { status: r.status, consultationDate: fecha(r.consultationDate) },
            hoy,
          ),
          consultationDate: fecha(r.consultationDate),
          patientName: r.patientName,
          doctorName: `${r.doctor.firstName} ${r.doctor.lastNamePaternal}`.trim(),
          createdAt: r.createdAt.toISOString(),
        })),
        total,
        page,
        pageSize,
      };
    });
  }

  async detail(user: AuthUser, id: string): Promise<RecordDetail> {
    return this.prisma.withTenantContext(user.tenantId, (tx) => this.cargar(tx, user.tenantId, id));
  }

  /** Idempotente: cerrar dos veces es un doble clic, no un error. */
  async close(user: AuthUser, id: string, meta: RequestMeta): Promise<RecordDetail> {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const hoy = await diaDelNegocio(tx, user.tenantId);
      const antes = await tx.medicalClinicRecord.findFirst({
        where: { id, tenantId: user.tenantId },
        select: { consultationDate: true },
      });
      const cerradas = await tx.medicalClinicRecord.updateMany({
        where: { id, tenantId: user.tenantId, status: "open" },
        data: { status: "closed", closedAt: new Date(), closedBy: user.userId },
      });
      if (cerradas.count === 1) {
        await this.auditService.record(tx, {
          tenantId: user.tenantId,
          userId: user.userId,
          action: "medical_clinic.record.close",
          resourceType: "medical_record",
          resourceId: id,
          // Un cierre tardío (la consulta era de otro día) se lee en la bitácora.
          after:
            antes === null
              ? undefined
              : {
                  consultationDate: fecha(antes.consultationDate),
                  closedOnConsultationDay: fecha(antes.consultationDate) === hoy,
                },
          ip: meta.ip,
          userAgent: meta.userAgent,
        });
      }
      return this.cargar(tx, user.tenantId, id, hoy);
    });
  }

  /** El expediente con sus relaciones, o 404: uno ajeno NO EXISTE para este negocio. */
  async cargar(tx: Tx, tenantId: string, id: string, hoy?: string): Promise<RecordDetail> {
    const fila = await tx.medicalClinicRecord.findFirst({
      where: { id, tenantId },
      include: INCLUDE,
    });
    if (fila === null) {
      throw new NotFoundException({ message: "medical_clinic.record_not_found" });
    }
    return toDetail(fila, hoy ?? (await diaDelNegocio(tx, tenantId)));
  }

  private async zonaDelNegocio(tenantId: string): Promise<string> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { timezone: true },
    });
    return tenant?.timezone ?? "UTC";
  }
}

export function toDetail(fila: RecordRow, hoy: string): RecordDetail {
  const porClave = new Map(fila.sections.map((s) => [s.sectionKey, s]));
  const consulta = fecha(fila.consultationDate);
  const lockReason = medicalRecordLock({ status: fila.status, consultationDate: consulta }, hoy);
  const nacimiento = fila.patientBirthDate === null ? null : fecha(fila.patientBirthDate);
  return {
    id: fila.id,
    folio: fila.folio,
    status: fila.status === "closed" ? "closed" : "open",
    editable: lockReason === null,
    lockReason,
    consultationDate: consulta,
    closedAt: fila.closedAt?.toISOString() ?? null,
    turnNumber: fila.turnNumber,
    patient: {
      customerId: fila.patientCustomerId,
      name: fila.patientName,
      birthDate: nacimiento,
      sex: fila.patientSex,
      age: nacimiento === null ? null : ageFromBirthDate(nacimiento, consulta),
    },
    doctor: {
      id: fila.doctor.id,
      name: `${fila.doctor.firstName} ${fila.doctor.lastNamePaternal}`.trim(),
    },
    // Las 32 del catálogo, en su orden: las que no tienen fila salen pendientes.
    sections: MEDICAL_RECORD_SECTIONS.map((def) => {
      const guardada = porClave.get(def.key);
      return {
        key: def.key,
        group: def.group,
        order: def.order,
        functional: def.functional,
        status: guardada === undefined ? "pending" : "completed",
        data: guardada === undefined ? null : ((guardada.data ?? {}) as Record<string, unknown>),
        updatedAt: guardada?.updatedAt?.toISOString() ?? null,
      };
    }),
    orders: fila.orders.map((o) => ({
      id: o.id,
      kind: o.kind,
      folio: o.folio,
      status: o.status,
      quoteId: o.quoteId,
      createdAt: o.createdAt.toISOString(),
    })),
    createdAt: fila.createdAt.toISOString(),
  };
}

const fecha = (d: Date): string => d.toISOString().slice(0, 10);

function nombreCompleto(p: {
  firstName: string;
  lastNamePaternal: string;
  lastNameMaternal: string | null;
}): string {
  return [p.firstName, p.lastNamePaternal, p.lastNameMaternal].filter(Boolean).join(" ");
}
