import * as fs from "node:fs";
import * as path from "node:path";

/**
 * BARRERA: todo permiso que el CÓDIGO exige tiene que existir en una MIGRACIÓN.
 *
 * ── El agujero que cierra, con nombre y fecha ────────────────────────────
 *
 * El 2026-08-21 el e2e del turno de caja pasó en local y **falló entero en CI
 * con 403**: el TenantAdmin recién registrado no tenía `pos:sell`. En local
 * andaba porque la base de desarrollo se había sembrado alguna vez; CI
 * construye la base solo con migraciones — que es exactamente lo que hace
 * producción.
 *
 * Al mirar la CLASE y no el caso, aparecieron DOS permisos que vivían solo en
 * `seed.ts` (dev/demo, no corre en el pipeline): `pos:sell` y `reports:read`.
 * En producción ninguno existía. El POS habría llegado inusable y el auditor
 * no habría visto un reporte.
 *
 * ── Por qué lee ARCHIVOS y no la base ───────────────────────────────────
 *
 * Comparar contra la base sería inútil justo donde importa: una base de
 * desarrollo sembrada tiene las filas y el test pasaría en verde, dejando el
 * fallo para CI. Leyendo el SQL de las migraciones, esto falla en la máquina
 * de quien lo rompe, que es donde sirve.
 */
const SRC = path.join(__dirname, "..", "..");
const MIGRATIONS = path.join(__dirname, "..", "..", "..", "prisma", "migrations");

/** Los codes que el código EXIGE, vía `@RequirePermissions("…")`. */
function permisosExigidos(): string[] {
  const codes = new Set<string>();

  const recorrer = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "generated") {
          recorrer(full);
        }
        continue;
      }
      if (!entry.name.endsWith(".ts") || entry.name.endsWith(".spec.ts")) {
        continue;
      }
      const contenido = fs.readFileSync(full, "utf8");
      for (const match of contenido.matchAll(/@RequirePermissions\(([^)]*)\)/g)) {
        for (const code of (match[1] ?? "").matchAll(/"([a-z_]+:[a-z_]+)"/g)) {
          if (code[1]) {
            codes.add(code[1]);
          }
        }
      }
    }
  };

  recorrer(SRC);
  return [...codes].sort();
}

/** Los codes que alguna MIGRACIÓN inserta en el catálogo global. */
function permisosSembrados(): Set<string> {
  const codes = new Set<string>();

  for (const dir of fs.readdirSync(MIGRATIONS, { withFileTypes: true })) {
    if (!dir.isDirectory()) {
      continue;
    }
    const file = path.join(MIGRATIONS, dir.name, "migration.sql");
    if (!fs.existsSync(file)) {
      continue;
    }
    const sql = fs.readFileSync(file, "utf8");
    // Solo dentro de un INSERT a `permissions`: un code mencionado en un
    // comentario o en un WHERE no lo CREA.
    for (const insert of sql.matchAll(/INSERT\s+INTO\s+permissions[^;]*;/gis)) {
      for (const code of (insert[0] ?? "").matchAll(/'([a-z_]+:[a-z_]+)'/g)) {
        if (code[1]) {
          codes.add(code[1]);
        }
      }
    }
  }

  return codes;
}

/**
 * Los codes que `seed.ts` declara. **Es dev/demo y NO corre en el pipeline**,
 * así que lo que solo viva ahí existe en la máquina de quien sembró y en
 * ninguna otra — pero es una lista de intención, y sirve para detectar el
 * hueco. `reports:read` se descubrió justo así: nadie lo exigía todavía con un
 * `@RequirePermissions`, así que el escáner de endpoints no podía verlo.
 */
function permisosDelSeed(): string[] {
  const seed = fs.readFileSync(path.join(MIGRATIONS, "..", "seed.ts"), "utf8");
  const codes = new Set<string>();
  for (const match of seed.matchAll(/code:\s*"([a-z_]+:[a-z_]+)"/g)) {
    if (match[1]) {
      codes.add(match[1]);
    }
  }
  return [...codes].sort();
}

describe("catálogo de permisos: el código y las migraciones no divergen", () => {
  it("el escáner encuentra permisos de verdad (no se volvió verde por vacío)", () => {
    expect(permisosExigidos().length).toBeGreaterThan(10);
    expect(permisosSembrados().size).toBeGreaterThan(10);
  });

  /**
   * `seed.ts` NO cuenta: es dev/demo y no corre en el pipeline. Un permiso que
   * solo viva ahí existe en la máquina de quien sembró y en ninguna otra.
   */
  it("todo permiso exigido por un endpoint existe en alguna migración", () => {
    const sembrados = permisosSembrados();
    const huerfanos = permisosExigidos().filter((code) => !sembrados.has(code));

    expect({ huerfanos }).toEqual({ huerfanos: [] });
  });

  /**
   * La otra mitad de la clase. `reports:read` NO lo exigía ningún endpoint
   * —Reportes es F5— así que el escáner de `@RequirePermissions` no podía
   * verlo, y sin embargo faltaba en producción igual. Un permiso que el seed
   * declara y ninguna migración crea es un permiso que solo existe en la
   * máquina de quien lo sembró.
   */
  it("todo permiso que declara el seed existe también en una migración", () => {
    const sembrados = permisosSembrados();
    const soloEnSeed = permisosDelSeed().filter((code) => !sembrados.has(code));

    expect({ soloEnSeed }).toEqual({ soloEnSeed: [] });
  });
});
