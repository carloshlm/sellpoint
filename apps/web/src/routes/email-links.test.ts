import { readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * GUARDARRAÍL DE LINKS DE MAIL.
 *
 * Bug real (2026-08-14, encontrado por Carlos en producción con un mail de
 * verdad): el backend mandaba `${APP_URL}/verify-email?token=...` y la única
 * ruta del front era `/verify` → el usuario hacía clic en el mail y veía
 * NOT FOUND. Ningún test lo detectó porque TODOS —unit, e2e de api, e2e de
 * web— ejercitaban el endpoint con el token directo; nadie verificaba que la
 * URL del mail resolviera a una página existente. El agujero vivía justo
 * entre las dos capas, donde cada una se testea bien por su lado.
 *
 * Estos paths se construyen en el backend (buscar `${this.appUrl}/` en
 * apps/api/src/modules/**). Si alguien agrega o renombra un flujo por mail,
 * este test falla hasta que exista la ruta del front que lo recibe.
 */
const PATHS_DE_LINKS_EN_MAILS = [
  // AuthService.registerTenant → mail `verify-email`
  "verify-email",
  // AuthService.forgotPassword → mail `reset-password`
  "reset-password",
  // UserInvitationService → mail `invite-user`
  "accept-invitation",
] as const;

describe("links de mail ↔ rutas del front", () => {
  const archivosDeRutas = readdirSync(join(__dirname));

  it.each(PATHS_DE_LINKS_EN_MAILS)(
    "el path '/%s' que el backend manda por mail tiene su ruta",
    (path) => {
      expect(archivosDeRutas).toContain(`${path}.tsx`);
    },
  );

  it("/verify sigue existiendo como alias: hay mails viejos apuntando ahí", () => {
    expect(archivosDeRutas).toContain("verify.tsx");
  });
});
