import { readdirSync, readFileSync } from "node:fs";
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

/**
 * D3 (cierre de f1-web-onboard, decisión de Carlos en #347): el token de un
 * link de mail NUNCA debe viajar por query string — así jamás termina en un
 * access log de servidor. Este guardián lee el código FUENTE de los 3
 * builders del backend (no ejecuta el servicio) y falla si alguno vuelve a
 * escribir `?token=`.
 */
const BUILDERS_DE_LINKS_CON_TOKEN = [
  join(__dirname, "../../../api/src/modules/auth/auth.service.ts"),
  join(__dirname, "../../../api/src/modules/users/user-invitation.service.ts"),
] as const;

describe("D3 — el token de los links de mail viaja por fragmento, no por query", () => {
  it.each(BUILDERS_DE_LINKS_CON_TOKEN)("%s no contiene '?token='", (path) => {
    const source = readFileSync(path, "utf-8");
    expect(source).not.toContain("?token=");
  });

  it.each(BUILDERS_DE_LINKS_CON_TOKEN)("%s sí usa '#token=' en al menos un link", (path) => {
    const source = readFileSync(path, "utf-8");
    expect(source).toContain("#token=");
  });
});
