import { describe, expect, it } from "vitest";
import {
  deleteTenantSchema,
  suspendTenantSchema,
  TENANT_DELETE_COOLING_DAYS,
  TENANT_RETENTION_DEFAULT_YEARS,
  TENANT_RETENTION_YEARS,
  tenantLifecycle,
  tenantRetentionYears,
} from "./tenant-lifecycle";

/**
 * F7-LIFECYCLE-01 — la regla del ciclo de vida de un negocio es CÓDIGO
 * compartido: el API decide con ella si se puede eliminar y el web pinta
 * con ella «se podrá eliminar a partir de…». Una sola verdad para el
 * enfriamiento de 30 días.
 */
describe("tenantLifecycle (F7-LIFECYCLE-01)", () => {
  const AHORA = new Date("2026-09-04T18:00:00.000Z");
  /** Un negocio que nunca pagó: prueba propia o registro abandonado. */
  const PRUEBA = { country: "MX", hasRealPayments: false };

  it("el enfriamiento son 30 días", () => {
    expect(TENANT_DELETE_COOLING_DAYS).toBe(30);
  });

  it("sin suspendedAt el negocio está activo y no es eliminable", () => {
    expect(tenantLifecycle({ ...PRUEBA, suspendedAt: null }, AHORA)).toEqual({
      suspended: false,
      suspendedDays: 0,
      retentionYears: null,
      deletableAt: null,
      deletable: false,
    });
  });

  it("suspendido hace 29 días: todavía no, y dice desde cuándo sí", () => {
    const hace29 = new Date(AHORA.getTime() - 29 * 24 * 60 * 60 * 1000);
    const resultado = tenantLifecycle({ ...PRUEBA, suspendedAt: hace29 }, AHORA);
    expect(resultado.suspended).toBe(true);
    expect(resultado.suspendedDays).toBe(29);
    expect(resultado.deletable).toBe(false);
    expect(resultado.deletableAt?.toISOString()).toBe("2026-09-05T18:00:00.000Z");
  });

  it("suspendido hace exactamente 30 días: eliminable", () => {
    const hace30 = new Date(AHORA.getTime() - 30 * 24 * 60 * 60 * 1000);
    const resultado = tenantLifecycle({ ...PRUEBA, suspendedAt: hace30 }, AHORA);
    expect(resultado.suspendedDays).toBe(30);
    expect(resultado.deletable).toBe(true);
  });

  it("acepta la fecha como texto ISO (así viaja por el API)", () => {
    const resultado = tenantLifecycle(
      { ...PRUEBA, suspendedAt: "2026-07-01T00:00:00.000Z" },
      AHORA,
    );
    expect(resultado.suspended).toBe(true);
    expect(resultado.suspendedDays).toBe(65);
    expect(resultado.deletable).toBe(true);
  });

  it("los días se cuentan completos, sin redondear hacia arriba", () => {
    const hace2ymedio = new Date(AHORA.getTime() - 2.5 * 24 * 60 * 60 * 1000);
    expect(tenantLifecycle({ ...PRUEBA, suspendedAt: hace2ymedio }, AHORA).suspendedDays).toBe(2);
  });
});

/**
 * F7-LIFECYCLE-10 — un CLIENTE (tiene al menos un pago real) no se elimina a
 * los 30 días: sus datos se conservan lo que pide la ley de su país, contado
 * desde la desactivación. Decisión de Carlos (2026-09-21): 10 años en México
 * (Código de Comercio), 7 en Canadá (CRA) y 7 en Estados Unidos (IRS).
 */
describe("retención legal de un cliente (F7-LIFECYCLE-10)", () => {
  const AHORA = new Date("2026-09-21T18:00:00.000Z");

  it("los plazos: México 10 años, Canadá y Estados Unidos 7", () => {
    expect(TENANT_RETENTION_YEARS).toEqual({ MX: 10, CA: 7, US: 7 });
  });

  it("un país desconocido o ausente toma el plazo MÁS largo, nunca el más corto", () => {
    expect(TENANT_RETENTION_DEFAULT_YEARS).toBe(10);
    expect(tenantRetentionYears(null)).toBe(10);
    expect(tenantRetentionYears("BR")).toBe(10);
    expect(tenantRetentionYears("MX")).toBe(10);
    expect(tenantRetentionYears("CA")).toBe(7);
    expect(tenantRetentionYears("US")).toBe(7);
  });

  it("el país llega de la base como char(2): se normaliza", () => {
    expect(tenantRetentionYears("ca")).toBe(7);
    expect(tenantRetentionYears(" US ")).toBe(7);
  });

  it("cliente mexicano desactivado hace 9 años: todavía NO, y dice hasta cuándo", () => {
    const resultado = tenantLifecycle(
      { suspendedAt: "2017-09-21T18:00:00.000Z", country: "MX", hasRealPayments: true },
      AHORA,
    );
    expect(resultado.retentionYears).toBe(10);
    expect(resultado.deletable).toBe(false);
    expect(resultado.deletableAt?.toISOString()).toBe("2027-09-21T18:00:00.000Z");
  });

  it("cliente mexicano desactivado hace exactamente 10 años: eliminable", () => {
    const resultado = tenantLifecycle(
      { suspendedAt: "2016-09-21T18:00:00.000Z", country: "MX", hasRealPayments: true },
      AHORA,
    );
    expect(resultado.deletable).toBe(true);
  });

  it("cliente canadiense: a los 7 años sí, un día antes no", () => {
    const base = { country: "CA", hasRealPayments: true };
    const justo = tenantLifecycle({ ...base, suspendedAt: "2019-09-21T18:00:00.000Z" }, AHORA);
    expect(justo.retentionYears).toBe(7);
    expect(justo.deletable).toBe(true);
    const unDiaAntes = tenantLifecycle({ ...base, suspendedAt: "2019-09-22T18:00:00.000Z" }, AHORA);
    expect(unDiaAntes.deletable).toBe(false);
    expect(unDiaAntes.deletableAt?.toISOString()).toBe("2026-09-22T18:00:00.000Z");
  });

  it("cliente de Estados Unidos: 7 años", () => {
    const resultado = tenantLifecycle(
      { suspendedAt: "2026-01-15T00:00:00.000Z", country: "US", hasRealPayments: true },
      AHORA,
    );
    expect(resultado.retentionYears).toBe(7);
    expect(resultado.deletableAt?.toISOString()).toBe("2033-01-15T00:00:00.000Z");
  });

  it("cliente SIN país: 10 años, el plazo más conservador", () => {
    const resultado = tenantLifecycle(
      { suspendedAt: "2026-01-15T00:00:00.000Z", country: null, hasRealPayments: true },
      AHORA,
    );
    expect(resultado.retentionYears).toBe(10);
    expect(resultado.deletableAt?.toISOString()).toBe("2036-01-15T00:00:00.000Z");
  });

  it("un cliente a los 31 días de desactivado NO es eliminable: los 30 días ya no le aplican", () => {
    const hace31 = new Date(AHORA.getTime() - 31 * 24 * 60 * 60 * 1000);
    const resultado = tenantLifecycle(
      { suspendedAt: hace31, country: "MX", hasRealPayments: true },
      AHORA,
    );
    expect(resultado.deletable).toBe(false);
  });

  it("sin pagos reales no hay retención: sigue el enfriamiento de 30 días, sea del país que sea", () => {
    const hace30 = new Date(AHORA.getTime() - 30 * 24 * 60 * 60 * 1000);
    for (const country of ["MX", "CA", "US", null]) {
      const resultado = tenantLifecycle(
        { suspendedAt: hace30, country, hasRealPayments: false },
        AHORA,
      );
      expect(resultado.retentionYears, String(country)).toBeNull();
      expect(resultado.deletable, String(country)).toBe(true);
    }
  });

  it("un cliente ACTIVO ya sabe su plazo, aunque todavía no corra", () => {
    const resultado = tenantLifecycle(
      { suspendedAt: null, country: "CA", hasRealPayments: true },
      AHORA,
    );
    expect(resultado.retentionYears).toBe(7);
    expect(resultado.deletableAt).toBeNull();
    expect(resultado.deletable).toBe(false);
  });
});

describe("los DTO del ciclo de vida", () => {
  it("el motivo de la suspensión va de 5 a 300 caracteres, recortado", () => {
    expect(suspendTenantSchema.safeParse({ reason: "  Impago reiterado  " }).data).toEqual({
      reason: "Impago reiterado",
    });
    expect(suspendTenantSchema.safeParse({ reason: "abcd" }).success).toBe(false);
    expect(suspendTenantSchema.safeParse({ reason: "x".repeat(301) }).success).toBe(false);
    expect(suspendTenantSchema.safeParse({}).success).toBe(false);
  });

  it("eliminar exige contraseña y el nombre a confirmar, sin recortar la contraseña", () => {
    expect(
      deleteTenantSchema.safeParse({ password: " secreta ", confirmName: " Negocio ONE " }).data,
    ).toEqual({ password: " secreta ", confirmName: "Negocio ONE" });
    expect(deleteTenantSchema.safeParse({ password: "", confirmName: "X" }).success).toBe(false);
    expect(deleteTenantSchema.safeParse({ password: "x", confirmName: "  " }).success).toBe(false);
  });
});
