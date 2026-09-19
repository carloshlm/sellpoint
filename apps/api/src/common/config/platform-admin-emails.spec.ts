import type { ConfigService } from "@nestjs/config";
import type { Env } from "../../config/env.schema";
import { platformAdminEmails } from "./platform-admin-emails";

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
    expect(platformAdminEmails(config(" Carls.HLM@gmail.com , otro@sellpointy.com "))).toEqual([
      "carls.hlm@gmail.com",
      "otro@sellpointy.com",
    ]);
  });

  it("una cadena vacía, ausente o de puras comas da una lista vacía, nunca [''] ", () => {
    expect(platformAdminEmails(config(""))).toEqual([]);
    expect(platformAdminEmails(config(undefined))).toEqual([]);
    expect(platformAdminEmails(config(" , , "))).toEqual([]);
  });

  it("un solo correo sin comas también es una lista", () => {
    expect(platformAdminEmails(config("carls.hlm@gmail.com"))).toEqual(["carls.hlm@gmail.com"]);
  });
});
