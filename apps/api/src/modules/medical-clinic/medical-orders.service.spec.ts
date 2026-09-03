import { Prisma } from "../../generated/prisma/client";
import { MedicalOrdersService } from "./medical-orders.service";

jest.mock("../inventory/folio", () => ({
  nextFolio: jest.fn((_tx: unknown, _t: string, key: string) =>
    Promise.resolve(key === "quote" ? "COT-000007" : "ORM-000003"),
  ),
}));

import { nextFolio } from "../inventory/folio";

/**
 * F9-CLINIC-14/15/23 — la orden médica crea su cotización con el MISMO folio
 * cuando el negocio vende ese tipo; si no, toma folio ORM sin cotización. La
 * receta resuelve precios con el MISMO código del POS; los estudios entran
 * como líneas de concepto con origen opaco. Cancelar cancela la cotización si
 * sigue abierta; cobrada, 409.
 */
const TENANT = "11111111-1111-1111-1111-111111111111";
const USER = { userId: "dr-1", tenantId: TENANT, permissions: [], locale: "es" as const };
const META = { ip: "127.0.0.1", userAgent: "jest" };
type Mock = jest.Mock;

describe("MedicalOrdersService (F9-CLINIC-14/15/23)", () => {
  let tx: {
    medicalClinicRecord: { findFirst: Mock };
    medicalClinicLabStudy: { findMany: Mock };
    medicalClinicDiagnosticStudy: { findMany: Mock };
    product: { findFirst: Mock };
    quote: { create: Mock; updateMany: Mock };
    medicalClinicOrder: { create: Mock; findFirst: Mock; findMany: Mock; updateMany: Mock };
    medicalClinicOrderLine: { createMany: Mock };
    user: { findFirst: Mock };
  };
  let prisma: { withTenantContext: Mock };
  let audit: { record: Mock };
  let quotes: { resolverLineasParaModulo: Mock };
  let settings: { leer: Mock };
  let service: MedicalOrdersService;
  let ultima: ReturnType<typeof ordenGuardada> | null;

  const ordenGuardada = (extra: Record<string, unknown> = {}) => ({
    id: "o-1",
    tenantId: TENANT,
    recordId: "r-1",
    kind: "lab_order",
    folio: "COT-000007",
    quoteId: "q-1",
    indications: null,
    diagnosis: null,
    status: "issued",
    canceledAt: null,
    canceledBy: null,
    createdBy: "dr-1",
    createdAt: new Date("2026-09-03T15:00:00.000Z"),
    updatedAt: new Date("2026-09-03T15:00:00.000Z"),
    lines: [],
    quote: { folio: "COT-000007", status: "open", sale: null },
    ...extra,
  });

  beforeEach(() => {
    ultima = null;
    tx = {
      medicalClinicRecord: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: "r-1", status: "open", consultationDate: new Date() }),
      },
      medicalClinicLabStudy: {
        findMany: jest.fn().mockResolvedValue([
          { id: "lab-1", name: "Biometría hemática", price: new Prisma.Decimal("180") },
          { id: "lab-2", name: "Glucosa", price: null },
        ]),
      },
      medicalClinicDiagnosticStudy: { findMany: jest.fn().mockResolvedValue([]) },
      product: {
        findFirst: jest.fn().mockResolvedValue({
          name: "Paracetamol",
          presentations: [
            { id: "p-1", name: "Caja", price: new Prisma.Decimal("45"), isDefaultSale: true },
          ],
        }),
      },
      quote: {
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: "q-1", ...data })),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      medicalClinicOrder: {
        // La orden recién creada es la que `cargar` vuelve a leer: con o sin cotización.
        create: jest.fn().mockImplementation(({ data }) => {
          ultima = ordenGuardada({
            ...data,
            quote: data.quoteId ? { folio: data.folio, status: "open", sale: null } : null,
          });
          return Promise.resolve(ultima);
        }),
        findFirst: jest.fn().mockImplementation(() => Promise.resolve(ultima ?? ordenGuardada())),
        findMany: jest.fn().mockResolvedValue([ordenGuardada()]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      medicalClinicOrderLine: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
      user: { findFirst: jest.fn().mockResolvedValue({ defaultWarehouseId: "w-1" }) },
      // La zona del negocio decide qué día es «hoy»: UTC para no depender del reloj.
      tenant: { findUniqueOrThrow: jest.fn().mockResolvedValue({ timezone: "UTC" }) },
    };
    prisma = { withTenantContext: jest.fn((_t: string, fn: (t: typeof tx) => unknown) => fn(tx)) };
    audit = { record: jest.fn() };
    quotes = {
      resolverLineasParaModulo: jest.fn().mockResolvedValue([
        {
          kind: "product",
          unitPrice: new Prisma.Decimal("45"),
          presentationId: "p-1",
          description: "Paracetamol — Caja",
          productId: "prod-1",
          serviceId: null,
          quantityBase: new Prisma.Decimal(2),
        },
      ]),
    };
    settings = {
      leer: jest.fn().mockResolvedValue({
        sellsMedications: true,
        sellsLabStudies: false,
        sellsDiagnosticStudies: false,
      }),
    };
    // biome-ignore lint/suspicious/noExplicitAny: mocks parciales a propósito
    service = new MedicalOrdersService(prisma as any, audit as any, quotes as any, settings as any);
    (nextFolio as Mock).mockClear();
  });

  it("una receta con venta crea la cotización con el MISMO folio y precios del POS", async () => {
    const res = await service.create(
      USER,
      "r-1",
      {
        kind: "prescription",
        lines: [{ productId: "prod-1", presentationId: "p-1", quantity: 2, dosage: "1 cada 8 h" }],
        indications: "Con alimentos",
      },
      META,
    );
    expect(quotes.resolverLineasParaModulo).toHaveBeenCalledWith(tx, USER, "w-1", [
      { productId: "prod-1", presentationId: "p-1", quantity: 2 },
    ]);
    const cot = tx.quote.create.mock.calls[0][0].data;
    expect(cot).toMatchObject({
      folio: "COT-000007",
      warehouseId: "w-1",
      sourceModule: "medical_clinic",
      createdBy: "dr-1",
    });
    expect(String(cot.total)).toBe("90");
    const orden = tx.medicalClinicOrder.create.mock.calls[0][0].data;
    expect(orden).toMatchObject({ folio: "COT-000007", quoteId: "q-1", kind: "prescription" });
    expect(orden.id).toBe(cot.sourceRef);
    const lineas = tx.medicalClinicOrderLine.createMany.mock.calls[0][0].data;
    expect(lineas[0]).toMatchObject({
      orderKind: "prescription",
      productId: "prod-1",
      presentationId: "p-1",
      description: "Paracetamol — Caja",
      dosage: "1 cada 8 h",
    });
    expect(String(lineas[0].unitPrice)).toBe("45");
    expect(res.chargeStatus).toBe("pending");
    expect(audit.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ action: "medical_clinic.order.create" }),
    );
  });

  it("sin venta de laboratorio, la orden toma folio ORM y NO crea cotización", async () => {
    const res = await service.create(
      USER,
      "r-1",
      {
        kind: "lab_order",
        lines: [
          { labStudyId: "lab-1", quantity: 1 },
          { labStudyId: "lab-2", quantity: 1 },
        ],
      },
      META,
    );
    expect(tx.quote.create).not.toHaveBeenCalled();
    expect(nextFolio).toHaveBeenCalledWith(tx, TENANT, "medical_order", "ORM");
    const orden = tx.medicalClinicOrder.create.mock.calls[0][0].data;
    expect(orden).toMatchObject({ folio: "ORM-000003", quoteId: null, kind: "lab_order" });
    const lineas = tx.medicalClinicOrderLine.createMany.mock.calls[0][0].data;
    expect(lineas.map((l: { description: string }) => l.description)).toEqual([
      "Biometría hemática",
      "Glucosa",
    ]);
    expect(String(lineas[1].unitPrice)).toBe("0");
    expect(res.chargeStatus).toBe("not_for_sale");
  });

  it("con venta de laboratorio, los estudios entran como conceptos con origen opaco", async () => {
    settings.leer.mockResolvedValue({
      sellsMedications: true,
      sellsLabStudies: true,
      sellsDiagnosticStudies: false,
    });
    await service.create(
      USER,
      "r-1",
      { kind: "lab_order", lines: [{ labStudyId: "lab-1", quantity: 1 }] },
      META,
    );
    const cot = tx.quote.create.mock.calls[0][0].data;
    const linea = cot.lines.create[0];
    expect(linea).toMatchObject({
      kind: "concept",
      description: "Biometría hemática",
      sourceModule: "medical_clinic",
    });
    expect(String(linea.unitPrice)).toBe("180");
    // El origen de la línea de la cotización es la LÍNEA de la orden.
    const lineasOrden = tx.medicalClinicOrderLine.createMany.mock.calls[0][0].data;
    expect(linea.sourceRef).toBe(lineasOrden[0].id);
    expect(String(cot.total)).toBe("180");
  });

  it("un estudio inactivo o ajeno es 422; un expediente cerrado es 409; sin líneas ni se intenta", async () => {
    tx.medicalClinicLabStudy.findMany.mockResolvedValue([]);
    await expect(
      service.create(
        USER,
        "r-1",
        { kind: "lab_order", lines: [{ labStudyId: "lab-x", quantity: 1 }] },
        META,
      ),
    ).rejects.toMatchObject({ response: { message: "medical_clinic.study_not_available" } });

    tx.medicalClinicRecord.findFirst.mockResolvedValue({
      id: "r-1",
      status: "closed",
      consultationDate: new Date(),
    });
    await expect(
      service.create(
        USER,
        "r-1",
        { kind: "lab_order", lines: [{ labStudyId: "lab-1", quantity: 1 }] },
        META,
      ),
    ).rejects.toMatchObject({ response: { message: "medical_clinic.record_closed" } });
  });

  it("una receta con venta y médico sin almacén es 404; sin venta no necesita almacén", async () => {
    tx.user.findFirst.mockResolvedValue({ defaultWarehouseId: null });
    await expect(
      service.create(
        USER,
        "r-1",
        { kind: "prescription", lines: [{ productId: "prod-1", quantity: 1 }] },
        META,
      ),
    ).rejects.toMatchObject({ response: { message: "medical_clinic.no_default_warehouse" } });

    settings.leer.mockResolvedValue({
      sellsMedications: false,
      sellsLabStudies: false,
      sellsDiagnosticStudies: false,
    });
    const res = await service.create(
      USER,
      "r-1",
      { kind: "prescription", lines: [{ productId: "prod-1", quantity: 1 }] },
      META,
    );
    expect(quotes.resolverLineasParaModulo).not.toHaveBeenCalled();
    expect(res.folio).toBe("ORM-000003");
    const lineas = tx.medicalClinicOrderLine.createMany.mock.calls[0][0].data;
    expect(lineas[0]).toMatchObject({ productId: "prod-1", description: "Paracetamol — Caja" });
  });

  it("cancelar: cobrada → 409; abierta → cancela orden y cotización; ORM solo la orden; dos veces → 409", async () => {
    tx.medicalClinicOrder.findFirst.mockResolvedValue(
      ordenGuardada({ quote: { folio: "COT-000007", status: "loaded", sale: { id: "v-1" } } }),
    );
    await expect(service.cancel(USER, "o-1", META)).rejects.toMatchObject({
      response: { message: "medical_clinic.order_already_charged" },
    });
    expect(tx.medicalClinicOrder.updateMany).not.toHaveBeenCalled();

    tx.medicalClinicOrder.findFirst.mockResolvedValue(ordenGuardada());
    await service.cancel(USER, "o-1", META);
    expect(tx.medicalClinicOrder.updateMany.mock.calls[0][0].where).toMatchObject({
      id: "o-1",
      status: "issued",
    });
    expect(tx.quote.updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: "q-1", status: "open" },
      data: { status: "canceled", canceledBy: "dr-1" },
    });

    tx.quote.updateMany.mockClear();
    tx.medicalClinicOrder.findFirst.mockResolvedValue(
      ordenGuardada({ folio: "ORM-000003", quoteId: null, quote: null }),
    );
    await service.cancel(USER, "o-1", META);
    expect(tx.quote.updateMany).not.toHaveBeenCalled();

    tx.medicalClinicOrder.findFirst.mockResolvedValue(ordenGuardada({ status: "canceled" }));
    await expect(service.cancel(USER, "o-1", META)).rejects.toMatchObject({
      response: { message: "medical_clinic.order_already_canceled" },
    });
  });

  it("el listado dice cómo va el cobro: cobrada, pendiente o sin cobro", async () => {
    tx.medicalClinicOrder.findMany.mockResolvedValue([
      ordenGuardada({ quote: { folio: "COT-000007", status: "loaded", sale: { id: "v-1" } } }),
      ordenGuardada({ id: "o-2" }),
      ordenGuardada({ id: "o-3", folio: "ORM-000003", quoteId: null, quote: null }),
    ]);
    const res = await service.list(USER, "r-1");
    expect(res.map((o) => o.chargeStatus)).toEqual(["charged", "pending", "not_for_sale"]);
    expect(res[0]).toMatchObject({ quoteFolio: "COT-000007", saleId: "v-1" });
  });

  /** F9-CLINIC-26 — una consulta abierta de otro día ya no emite órdenes. */
  it("un expediente abierto de OTRO DÍA rebota con 409 record_expired", async () => {
    tx.medicalClinicRecord.findFirst.mockResolvedValue({
      id: "r-1",
      status: "open",
      consultationDate: new Date("2020-01-01"),
    });
    await expect(
      service.create(USER, "r-1", { kind: "lab_order", lines: [{ labStudyId: "ls-1" }] }, META),
    ).rejects.toMatchObject({ response: { message: "medical_clinic.record_expired" } });
    expect(tx.medicalClinicOrder.create).not.toHaveBeenCalled();
  });
});
