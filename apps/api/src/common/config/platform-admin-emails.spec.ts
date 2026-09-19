import type { ConfigService } from "@nestjs/config";
import type { Env } from "../../config/env.schema";
import { platformAdminEmails, platformNotifyEmails } from "./platform-admin-emails";

function config(value: string | undefined): ConfigService<Env, true> {
  return { get: () => value } as unknown as ConfigService<Env, true>;
}

/**
 * El mismo parseo que ya hacían `BillingService.requestPlan` y
 * `PlatformAdminGuard`, palabra por palabra: esta extracción NO cambia el
 * comportamiento, solo deja de copiarlo en tres lugares (el tercero es el
 * aviso de un prospecto del sitio, F11-SITE-LEAD-04).
 */
describe("platformAdminEmails", () => {
  it("separa por comas, recorta y baja a minúsculas", () => {
    expect(platformAdminEmails(config(" Admin@Example.com , otro@sellpointy.com "))).toEqual([
      "admin@example.com",
      "otro@sellpointy.com",
    ]);
  });

  it("una cadena vacía, ausente o de puras comas da una lista vacía, nunca [''] ", () => {
    expect(platformAdminEmails(config(""))).toEqual([]);
    expect(platformAdminEmails(config(undefined))).toEqual([]);
    expect(platformAdminEmails(config(" , , "))).toEqual([]);
  });

  it("un solo correo sin comas también es una lista", () => {
    expect(platformAdminEmails(config("admin@example.com"))).toEqual(["admin@example.com"]);
  });
});

/**
 * Carlos (2026-09-19): los avisos del sistema van a `contact@sellpointy.com`,
 * pero él sigue entrando al backoffice con su correo personal. Hasta ese día
 * «a quién se le avisa» y «quién puede entrar» tenían la misma respuesta, y por
 * eso una sola variable alcanzaba.
 */
describe("platformNotifyEmails", () => {
  const configOf = (values: Record<string, string | undefined>): ConfigService<Env, true> =>
    ({ get: (key: string) => values[key] }) as unknown as ConfigService<Env, true>;

  it("los avisos van a PLATFORM_NOTIFY_EMAILS, no a la lista blanca del backoffice", () => {
    const config = configOf({
      BILLING_ADMIN_EMAILS: "dueno@example.com",
      PLATFORM_NOTIFY_EMAILS: " Contact@SellPointy.com , ventas@example.com ",
    });
    expect(platformNotifyEmails(config)).toEqual(["contact@sellpointy.com", "ventas@example.com"]);
    // Y la lista blanca NO cambia: quien entra sigue siendo quien entraba.
    expect(platformAdminEmails(config)).toEqual(["dueno@example.com"]);
  });

  it("vacía o ausente, los avisos caen en la lista de siempre: nunca se quedan sin destinatario", () => {
    // Desplegar este cambio ANTES de editar el `.env` no puede apagar los avisos.
    for (const value of ["", undefined, " , "]) {
      const config = configOf({
        BILLING_ADMIN_EMAILS: "dueno@example.com",
        PLATFORM_NOTIFY_EMAILS: value,
      });
      expect(platformNotifyEmails(config)).toEqual(["dueno@example.com"]);
    }
  });
});
