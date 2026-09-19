import { BadRequestException } from "@nestjs/common";
import type { AuthUser } from "../auth/types/auth-user";
import { TermsService } from "./terms.service";

/**
 * F11-SITE-LEGAL-02/03 — el guardián de la aceptación, en sus DOS estados.
 *
 * Cada caso de este archivo se prueba dormido y encendido. No es simetría
 * decorativa: lo que se despliega HOY es el estado dormido, y una prueba que
 * solo cubriera el encendido dejaría sin red justo el código que corre en
 * producción desde el primer día.
 */

const AHORA = new Date("2026-10-05T12:00:00.000Z");
const USUARIO: AuthUser = {
  userId: "user-1",
  tenantId: "tenant-1",
  permissions: [],
  locale: "es",
};

function buildService(version: string | null) {
  const tx = {
    user: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({ termsVersion: null, termsAcceptedAt: null }),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const prisma = {
    withTenantContext: jest.fn((_tenantId: string, callback: (tx: unknown) => Promise<unknown>) =>
      callback(tx),
    ),
  };
  const auditService = { record: jest.fn().mockResolvedValue(undefined) };
  const clock = { now: () => AHORA };

  const service = new TermsService(version, prisma as never, auditService as never, clock as never);
  return { service, prisma, auditService, tx };
}

describe("TermsService dormido (CURRENT_TERMS_VERSION = null)", () => {
  it("no hay versión vigente", () => {
    expect(buildService(null).service.currentVersion).toBeNull();
  });

  it("nadie debe aceptar nada, haya aceptado antes o no", () => {
    const { service } = buildService(null);

    expect(service.mustAccept(null)).toBe(false);
    expect(service.mustAccept("2026-01-01")).toBe(false);
  });

  it("el registro NO exige la casilla: un alta sin `acceptTerms` pasa", () => {
    const { service } = buildService(null);

    expect(() => service.requireAcceptance(undefined)).not.toThrow();
    expect(() => service.requireAcceptance(false)).not.toThrow();
  });

  it("el registro no sella nada: el usuario nace con las dos columnas en NULL", () => {
    const { service } = buildService(null);

    expect(service.acceptanceForRegistration()).toBeNull();
  });

  it("aceptar es un no-op: responde en null y no escribe ni audita", async () => {
    const { service, prisma, auditService } = buildService(null);

    await expect(service.accept(USUARIO, {})).resolves.toEqual({
      termsVersion: null,
      acceptedAt: null,
    });
    expect(prisma.withTenantContext).not.toHaveBeenCalled();
    expect(auditService.record).not.toHaveBeenCalled();
  });
});

describe("TermsService encendido (CURRENT_TERMS_VERSION = '2026-10-01')", () => {
  const VERSION = "2026-10-01";

  it("expone la versión vigente", () => {
    expect(buildService(VERSION).service.currentVersion).toBe(VERSION);
  });

  it("debe aceptar quien nunca aceptó y quien aceptó una versión vieja", () => {
    const { service } = buildService(VERSION);

    expect(service.mustAccept(null)).toBe(true);
    expect(service.mustAccept("2026-09-01")).toBe(true);
    expect(service.mustAccept(VERSION)).toBe(false);
  });

  it("el registro SIN la casilla muere con su propia clave i18n, no con la genérica", () => {
    const { service } = buildService(VERSION);

    expect(() => service.requireAcceptance(undefined)).toThrow(BadRequestException);
    try {
      service.requireAcceptance(false);
    } catch (error) {
      expect((error as BadRequestException).getResponse()).toEqual({
        message: "auth.terms_not_accepted",
      });
    }
  });

  it("el registro CON la casilla pasa y devuelve el sello para el INSERT", () => {
    const { service } = buildService(VERSION);

    expect(() => service.requireAcceptance(true)).not.toThrow();
    expect(service.acceptanceForRegistration()).toEqual({
      termsVersion: VERSION,
      termsAcceptedAt: AHORA,
    });
  });

  it("aceptar sella versión y fecha en la fila del usuario, dentro del contexto de tenant", async () => {
    const { service, prisma, tx, auditService } = buildService(VERSION);

    const result = await service.accept(USUARIO, { ip: "10.0.0.1" });

    expect(prisma.withTenantContext).toHaveBeenCalledWith("tenant-1", expect.any(Function));
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { termsVersion: VERSION, termsAcceptedAt: AHORA },
    });
    expect(auditService.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        tenantId: "tenant-1",
        userId: "user-1",
        action: "legal.terms.accepted",
        after: { termsVersion: VERSION },
      }),
    );
    expect(result).toEqual({ termsVersion: VERSION, acceptedAt: AHORA.toISOString() });
  });

  it("aceptar dos veces es idempotente: la segunda no vuelve a escribir ni mueve la fecha", async () => {
    const ayer = new Date("2026-10-04T09:00:00.000Z");
    const { service, tx } = buildService(VERSION);
    tx.user.findUniqueOrThrow.mockResolvedValue({
      termsVersion: VERSION,
      termsAcceptedAt: ayer,
    });

    const result = await service.accept(USUARIO, {});

    expect(tx.user.update).not.toHaveBeenCalled();
    expect(result).toEqual({ termsVersion: VERSION, acceptedAt: ayer.toISOString() });
  });
});
