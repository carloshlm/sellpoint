import { ConfigService } from "@nestjs/config";
import type { Env } from "../../config/env.schema";
import type { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";

/**
 * Integration (Postgres real) — F9-CLINIC-02/03/04/21: el modelo de datos
 * del Consultorio Médico.
 *
 * Lo que fija:
 *  - las siete tablas `medical_clinic_*` llevan la RLS canónica desde el
 *    minuto cero (con el rol REAL de la app, sin bypass);
 *  - los CHECKs de coherencia (un expediente cerrado sin hora, un sexo fuera
 *    del catálogo, una línea de gabinete en una receta, un folio `COT-` sin
 *    cotización) no pueden existir ni por bug;
 *  - borrar al cliente deja el expediente vivo con el snapshot; borrar el
 *    expediente arrastra sus secciones; un estudio en una orden no se borra.
 */
describe("modelo de datos del Consultorio Médico (F9-CLINIC-02/03/04/21)", () => {
  let prisma: PrismaService;
  let tenantA: string;
  let tenantB: string;
  let doctorA: string;
  const stamp = Date.now();
  const hoy = new Date("2026-09-03");

  /** Transacción con el rol REAL de la app (sin bypass de RLS). */
  const asAppRole = <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> =>
    prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL ROLE sellpoint_app`;
      return fn(tx);
    });

  const expediente = (tenantId: string, doctor: string, folio: string, extra = {}) => ({
    tenantId,
    folio,
    patientName: "Ana Pérez",
    doctorUserId: doctor,
    consultationDate: hoy,
    ...extra,
  });

  beforeAll(async () => {
    prisma = new PrismaService(
      new ConfigService<Env, true>({ DATABASE_URL: process.env.DATABASE_URL }),
    );
    await prisma.onModuleInit();
    tenantA = (await prisma.tenant.create({ data: { name: `Clinic A ${stamp}` } })).id;
    tenantB = (await prisma.tenant.create({ data: { name: `Clinic B ${stamp}` } })).id;
    const medico = async (tenantId: string) =>
      (
        await prisma.withTenantContext(tenantId, (tx) =>
          tx.user.create({
            data: {
              tenantId,
              email: `dr-${stamp}-${tenantId.slice(0, 6)}@example.com`,
              firstName: "Gregorio",
              lastNamePaternal: "House",
            },
          }),
        )
      ).id;
    doctorA = await medico(tenantA);
    await medico(tenantB);
    for (const tenantId of [tenantA, tenantB]) {
      await prisma.withTenantContext(tenantId, async (tx) => {
        await tx.medicalClinicLabStudy.create({
          data: { tenantId, code: "BH", name: "Biometría hemática", price: "180" },
        });
        await tx.medicalClinicSettings.create({ data: { tenantId } });
      });
    }
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  describe("RLS en las siete tablas", () => {
    it.each([
      "medicalClinicLabStudy",
      "medicalClinicDiagnosticStudy",
      "medicalClinicRecord",
      "medicalClinicRecordSection",
      "medicalClinicOrder",
      "medicalClinicOrderLine",
      "medicalClinicSettings",
    ] as const)(
      "%s: sin contexto de tenant, cero filas con el rol real de la app",
      async (modelo) => {
        const filas = await asAppRole((tx) =>
          (tx[modelo] as unknown as { findMany: () => Promise<unknown[]> }).findMany(),
        );
        expect(filas).toHaveLength(0);
      },
    );

    it("el contexto del tenant A no ve el catálogo ni la configuración del tenant B", async () => {
      const [estudios, ajustes] = await asAppRole(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantA}::text, true)`;
        return Promise.all([
          tx.medicalClinicLabStudy.findMany({ where: { tenantId: { in: [tenantA, tenantB] } } }),
          tx.medicalClinicSettings.findMany({ where: { tenantId: { in: [tenantA, tenantB] } } }),
        ]);
      });
      expect(estudios.map((f) => f.tenantId)).toEqual([tenantA]);
      expect(ajustes.map((f) => f.tenantId)).toEqual([tenantA]);
    });

    it("WITH CHECK: desde el contexto de A no se inserta un estudio de B", async () => {
      await expect(
        asAppRole(async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantA}::text, true)`;
          return tx.medicalClinicLabStudy.create({
            data: { tenantId: tenantB, code: "CRUZADO", name: "Cruzado" },
          });
        }),
      ).rejects.toThrow();
    });
  });

  describe("catálogos (F9-CLINIC-02)", () => {
    it("el mismo código cabe en dos negocios, no dos veces en el mismo", async () => {
      await expect(
        prisma.withTenantContext(tenantA, (tx) =>
          tx.medicalClinicLabStudy.create({
            data: { tenantId: tenantA, code: "BH", name: "Otra" },
          }),
        ),
      ).rejects.toMatchObject({ code: "P2002" });
    });

    it("un precio negativo o un código vacío rebotan en el CHECK", async () => {
      await expect(
        prisma.withTenantContext(tenantA, (tx) =>
          tx.medicalClinicDiagnosticStudy.create({
            data: { tenantId: tenantA, code: "RX", name: "Rayos X", price: "-1" },
          }),
        ),
      ).rejects.toThrow();
      await expect(
        prisma.withTenantContext(tenantA, (tx) =>
          tx.medicalClinicDiagnosticStudy.create({
            data: { tenantId: tenantA, code: "  ", name: "X" },
          }),
        ),
      ).rejects.toThrow();
    });
  });

  describe("expediente y secciones (F9-CLINIC-03)", () => {
    it("un expediente cerrado sin hora, o con sexo fuera del catálogo, rebota", async () => {
      await expect(
        prisma.withTenantContext(tenantA, (tx) =>
          tx.medicalClinicRecord.create({
            data: expediente(tenantA, doctorA, "HCL-000901", { status: "closed" }),
          }),
        ),
      ).rejects.toThrow();
      await expect(
        prisma.withTenantContext(tenantA, (tx) =>
          tx.medicalClinicRecord.create({
            data: expediente(tenantA, doctorA, "HCL-000902", { patientSex: "Q" }),
          }),
        ),
      ).rejects.toThrow();
    });

    /** F9-CLINIC-27 — la regla «una consulta abierta por paciente y día» en la base. */
    it("dos consultas ABIERTAS del mismo paciente y día rebotan; cerradas o de otro día caben", async () => {
      const paciente = await prisma.withTenantContext(tenantA, (tx) =>
        tx.customer.create({
          data: { tenantId: tenantA, firstName: "Rosa", lastNamePaternal: "Luna" },
        }),
      );
      const abrir = (folio: string, extra = {}) =>
        prisma.withTenantContext(tenantA, (tx) =>
          tx.medicalClinicRecord.create({
            data: expediente(tenantA, doctorA, folio, {
              patientCustomerId: paciente.id,
              ...extra,
            }),
          }),
        );

      await abrir("HCL-000910");
      await expect(abrir("HCL-000911")).rejects.toThrow();

      // Otro día: es otra consulta, cabe.
      const ayer = new Date(hoy);
      ayer.setUTCDate(ayer.getUTCDate() - 1);
      await expect(abrir("HCL-000912", { consultationDate: ayer })).resolves.toBeTruthy();

      // Cerrada: ya no estorba, el paciente puede volver por la tarde.
      await expect(
        abrir("HCL-000913", { status: "closed", closedAt: new Date(), closedBy: doctorA }),
      ).resolves.toBeTruthy();
    });

    it("dos filas de la misma sección rebotan; borrar el expediente arrastra las suyas", async () => {
      const id = await prisma.withTenantContext(tenantA, async (tx) => {
        const rec = await tx.medicalClinicRecord.create({
          data: expediente(tenantA, doctorA, "HCL-000903"),
        });
        await tx.medicalClinicRecordSection.create({
          data: {
            tenantId: tenantA,
            recordId: rec.id,
            sectionKey: "general_data",
            data: { sex: "F" },
          },
        });
        return rec.id;
      });
      await expect(
        prisma.withTenantContext(tenantA, (tx) =>
          tx.medicalClinicRecordSection.create({
            data: { tenantId: tenantA, recordId: id, sectionKey: "general_data", data: {} },
          }),
        ),
      ).rejects.toMatchObject({ code: "P2002" });

      const restantes = await prisma.withTenantContext(tenantA, async (tx) => {
        await tx.medicalClinicRecord.delete({ where: { id } });
        return tx.medicalClinicRecordSection.count({ where: { recordId: id } });
      });
      expect(restantes).toBe(0);
    });

    it("borrar al cliente deja el expediente vivo: patient_customer_id NULL y el nombre en el snapshot", async () => {
      const rec = await prisma.withTenantContext(tenantA, async (tx) => {
        const cliente = await tx.customer.create({
          data: { tenantId: tenantA, firstName: "Rosa", lastNamePaternal: "Luna" },
        });
        const creado = await tx.medicalClinicRecord.create({
          data: expediente(tenantA, doctorA, "HCL-000904", {
            patientCustomerId: cliente.id,
            patientName: "Rosa Luna",
          }),
        });
        await tx.customer.delete({ where: { id: cliente.id } });
        return tx.medicalClinicRecord.findUniqueOrThrow({ where: { id: creado.id } });
      });
      expect(rec.patientCustomerId).toBeNull();
      expect(rec.patientName).toBe("Rosa Luna");
    });
  });

  describe("órdenes y líneas (F9-CLINIC-04)", () => {
    let recordId: string;
    let labStudyId: string;

    beforeAll(async () => {
      await prisma.withTenantContext(tenantA, async (tx) => {
        recordId = (
          await tx.medicalClinicRecord.create({
            data: expediente(tenantA, doctorA, "HCL-000905"),
          })
        ).id;
        labStudyId = (
          await tx.medicalClinicLabStudy.findFirstOrThrow({ where: { tenantId: tenantA } })
        ).id;
      });
    });

    const orden = (folio: string, kind: string, extra = {}) => ({
      tenantId: tenantA,
      recordId,
      kind,
      folio,
      createdBy: doctorA,
      ...extra,
    });

    it("una línea de laboratorio en una RECETA rebota; dos referencias rebotan; cantidad 0 rebota", async () => {
      const recetaId = (
        await prisma.withTenantContext(tenantA, (tx) =>
          tx.medicalClinicOrder.create({ data: orden("ORM-000901", "prescription") }),
        )
      ).id;
      const linea = (extra: Record<string, unknown>) =>
        prisma.withTenantContext(tenantA, (tx) =>
          tx.medicalClinicOrderLine.create({
            data: {
              tenantId: tenantA,
              orderId: recetaId,
              orderKind: "prescription",
              lineNo: 1,
              description: "x",
              quantity: 1,
              unitPrice: 0,
              ...extra,
            },
          }),
        );
      await expect(linea({ labStudyId })).rejects.toThrow();
      const producto = await prisma.withTenantContext(tenantA, (tx) =>
        tx.product.create({ data: { tenantId: tenantA, sku: `P-${stamp}`, name: "Paracetamol" } }),
      );
      await expect(linea({ productId: producto.id, labStudyId })).rejects.toThrow();
      await expect(linea({ productId: producto.id, quantity: 0 })).rejects.toThrow();
      await expect(linea({ productId: producto.id })).resolves.toMatchObject({ lineNo: 1 });
    });

    it("un estudio que ya está en una orden no se borra (RESTRICT)", async () => {
      await prisma.withTenantContext(tenantA, async (tx) => {
        const lab = await tx.medicalClinicOrder.create({ data: orden("ORM-000902", "lab_order") });
        await tx.medicalClinicOrderLine.create({
          data: {
            tenantId: tenantA,
            orderId: lab.id,
            orderKind: "lab_order",
            lineNo: 1,
            labStudyId,
            description: "Biometría hemática",
            quantity: 1,
            unitPrice: 180,
          },
        });
      });
      await expect(
        prisma.withTenantContext(tenantA, (tx) =>
          tx.medicalClinicLabStudy.delete({ where: { id: labStudyId } }),
        ),
      ).rejects.toMatchObject({ code: "P2003" });
    });

    it("el prefijo no miente: COT- sin cotización rebota; varias ORM- sin cotización caben", async () => {
      await expect(
        prisma.withTenantContext(tenantA, (tx) =>
          tx.medicalClinicOrder.create({ data: orden("COT-000909", "lab_order") }),
        ),
      ).rejects.toThrow();
      await expect(
        prisma.withTenantContext(tenantA, (tx) =>
          tx.medicalClinicOrder.create({ data: orden("ORM-000903", "diagnostic_order") }),
        ),
      ).resolves.toMatchObject({ quoteId: null });
    });

    it("una cotización solo sostiene UNA orden (UNIQUE quote_id)", async () => {
      const quoteId = await prisma.withTenantContext(tenantA, async (tx) => {
        const almacen = await tx.warehouse.create({
          data: { tenantId: tenantA, code: `W-${stamp}`, name: "Central" },
        });
        const q = await tx.quote.create({
          data: {
            tenantId: tenantA,
            folio: "COT-000901",
            warehouseId: almacen.id,
            total: 0,
            createdBy: doctorA,
          },
        });
        await tx.medicalClinicOrder.create({
          data: orden("COT-000901", "lab_order", { quoteId: q.id }),
        });
        return q.id;
      });
      await expect(
        prisma.withTenantContext(tenantA, (tx) =>
          tx.medicalClinicOrder.create({
            data: orden("COT-000902", "lab_order", { quoteId }),
          }),
        ),
      ).rejects.toMatchObject({ code: "P2002" });
    });
  });

  describe("configuración (F9-CLINIC-21)", () => {
    it("nace vendiendo solo medicamentos, y hay una fila por negocio", async () => {
      const fila = await prisma.withTenantContext(tenantA, (tx) =>
        tx.medicalClinicSettings.findUniqueOrThrow({ where: { tenantId: tenantA } }),
      );
      expect(fila).toMatchObject({
        sellsMedications: true,
        sellsLabStudies: false,
        sellsDiagnosticStudies: false,
      });
      await expect(
        prisma.withTenantContext(tenantA, (tx) =>
          tx.medicalClinicSettings.create({ data: { tenantId: tenantA } }),
        ),
      ).rejects.toMatchObject({ code: "P2002" });
    });
  });
});
