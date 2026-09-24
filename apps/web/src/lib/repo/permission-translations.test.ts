import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * BARRERA (F10-MANFIX-05d) — todo permiso SEMBRADO en el catálogo global
 * (`permissions`, poblado por las migraciones SQL de `apps/api`) tiene un
 * NOMBRE en español Y en inglés en `users.json`, y lo mismo su GRUPO (módulo).
 *
 * **El bug que cierra:** `PermissionChecklist` mostraba el CÓDIGO crudo
 * (`pos:sell`) y el módulo tal cual vive en la base (`medical_clinic`, con el
 * guion bajo intacto — `capitalize` de CSS no inserta espacios). Un dueño de
 * negocio no sabe qué es "pos:sell"; sí sabe qué es "Vender en caja".
 *
 * **Por qué lee las MIGRACIONES y no `permission-checklist.tsx` ni un mock**:
 * mismo criterio que `permissions-catalog.spec.ts` del API — la verdad de
 * "qué permisos existen" vive en lo que una migración YA insertó, no en lo
 * que alguna pantalla de prueba decide mockear. Agregar un permiso nuevo sin
 * agregar su traducción revienta ACÁ, no en producción con un dueño mirando
 * "purchases:cancel" en su lista de roles.
 */
const RAIZ = join(__dirname, "../../../../..");
const MIGRATIONS = join(RAIZ, "apps/api/prisma/migrations");

/** Cada permiso SEMBRADO por alguna migración, con su módulo (code → module). */
function permisosSembrados(): Map<string, string> {
  const pares = new Map<string, string>();
  for (const dir of readdirSync(MIGRATIONS, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const file = join(MIGRATIONS, dir.name, "migration.sql");
    if (!existsSync(file)) continue;
    const sql = readFileSync(file, "utf8");
    // Solo dentro de un INSERT a `permissions`: un code mencionado en un
    // comentario o en un WHERE no lo CREA (mismo criterio que el API).
    for (const insert of sql.matchAll(/INSERT\s+INTO\s+permissions[^;]*;/gis)) {
      for (const fila of insert[0].matchAll(/\(\s*'([a-z_]+:[a-z_]+)'\s*,\s*'([a-z_]+)'/g)) {
        const code = fila[1];
        const module = fila[2];
        if (code && module) pares.set(code, module);
      }
    }
  }
  return pares;
}

/** Busca `obj.a.b.c` a mano: nada de `t()` — el `:` del code rompería el nsSeparator de i18next. */
function porRuta(obj: unknown, ruta: string[]): unknown {
  return ruta.reduce<unknown>(
    (actual, clave) =>
      typeof actual === "object" && actual !== null
        ? (actual as Record<string, unknown>)[clave]
        : undefined,
    obj,
  );
}

const esUsers = JSON.parse(readFileSync(join(RAIZ, "apps/web/src/i18n/es/users.json"), "utf8"));
const enUsers = JSON.parse(readFileSync(join(RAIZ, "apps/web/src/i18n/en/users.json"), "utf8"));

const sembrados = permisosSembrados();
const modulos = [...new Set(sembrados.values())].sort();
const codigos = [...sembrados.keys()].sort();

describe("catálogo de permisos: todo lo sembrado tiene nombre en es/en", () => {
  it("el escáner encuentra permisos de verdad (no se volvió verde por vacío)", () => {
    expect(sembrados.size).toBeGreaterThan(10);
    expect(modulos.length).toBeGreaterThan(3);
  });

  it.each(modulos)("el grupo «%s» tiene nombre en español y en inglés", (module) => {
    const es = porRuta(esUsers, ["roles", "permissionCatalog", "groups", module]);
    const en = porRuta(enUsers, ["roles", "permissionCatalog", "groups", module]);
    expect(typeof es, `falta users.roles.permissionCatalog.groups.${module} en es/users.json`).toBe(
      "string",
    );
    expect(typeof en, `falta users.roles.permissionCatalog.groups.${module} en en/users.json`).toBe(
      "string",
    );
    // Ni vacío ni el código crudo disfrazado.
    expect((es as string).length).toBeGreaterThan(0);
    expect((en as string).length).toBeGreaterThan(0);
  });

  it.each(codigos)("el permiso «%s» tiene nombre en español y en inglés", (code) => {
    const [module, action] = code.split(":");
    const es = porRuta(esUsers, [
      "roles",
      "permissionCatalog",
      "permissions",
      module as string,
      action as string,
    ]);
    const en = porRuta(enUsers, [
      "roles",
      "permissionCatalog",
      "permissions",
      module as string,
      action as string,
    ]);
    expect(
      typeof es,
      `falta users.roles.permissionCatalog.permissions.${module}.${action} en es/users.json`,
    ).toBe("string");
    expect(
      typeof en,
      `falta users.roles.permissionCatalog.permissions.${module}.${action} en en/users.json`,
    ).toBe("string");
    expect((es as string).length).toBeGreaterThan(0);
    expect((en as string).length).toBeGreaterThan(0);
    // El nombre NO es el código crudo: eso es exactamente el bug que se cierra.
    expect(es).not.toBe(code);
    expect(en).not.toBe(code);
  });
});
