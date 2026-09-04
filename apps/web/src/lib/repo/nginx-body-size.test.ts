import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * BARRERA: todo bloque `location /api/` de nginx declara un
 * `client_max_body_size` por ENCIMA del tope de body del API.
 *
 * **El porqué:** nginx trae 1 MB de fábrica y rebota con un 413 en HTML que
 * ninguna pantalla sabe leer. Ya pasó (2026-09-04): el logotipo del ticket
 * —hasta 2 MB, ~2.7 MB en base64— fallaba en producción con «No pudimos
 * subir la imagen» mientras en local, sin nginx, funcionaba. Con el tope del
 * borde más alto que el del API, el que dice «no» es el API, en JSON y en el
 * idioma de la persona.
 *
 * El tope del API se lee de `body-limits.ts`: si sube allá y nadie toca
 * nginx, este test lo dice antes que un cliente.
 */
const RAIZ = join(__dirname, "../../../../..");
const CONF_D = join(RAIZ, "infrastructure/nginx/conf.d");

/** El `JSON_BODY_LIMIT` del API, en megabytes. */
function topeDelApiEnMb(): number {
  const fuente = readFileSync(join(RAIZ, "apps/api/src/common/http/body-limits.ts"), "utf8");
  const m = /JSON_BODY_LIMIT\s*=\s*"(\d+)mb"/.exec(fuente);
  if (!m?.[1]) throw new Error("No encontré JSON_BODY_LIMIT en body-limits.ts");
  return Number(m[1]);
}

/** Los bloques `location /api/ { … }` de un vhost (sin llaves anidadas adentro). */
function bloquesApi(conf: string): string[] {
  return [...conf.matchAll(/location \/api\/ \{([^}]*)\}/g)].map((m) => m[1] ?? "");
}

function topeDelBloqueEnMb(bloque: string): number | null {
  const m = /client_max_body_size\s+(\d+)([mk]?);/i.exec(bloque);
  if (!m?.[1]) return null;
  const valor = Number(m[1]);
  return m[2]?.toLowerCase() === "k" ? valor / 1024 : valor;
}

describe("nginx: el borde deja pasar lo que el API acepta", () => {
  const vhosts = readdirSync(CONF_D).filter((f) => f.endsWith(".conf"));
  const conApi = vhosts.filter((f) => bloquesApi(readFileSync(join(CONF_D, f), "utf8")).length > 0);

  it("hay vhosts con bloque /api/ (si no, la barrera no vigila nada)", () => {
    expect(conApi.length).toBeGreaterThan(0);
  });

  it.each(conApi)("%s: cada location /api/ declara client_max_body_size ≥ el del API", (vhost) => {
    const tope = topeDelApiEnMb();
    for (const bloque of bloquesApi(readFileSync(join(CONF_D, vhost), "utf8"))) {
      const declarado = topeDelBloqueEnMb(bloque);
      expect(
        declarado,
        `${vhost}: el bloque location /api/ no declara client_max_body_size; ` +
          `nginx aplica 1 MB y el API acepta ${tope} MB.`,
      ).not.toBeNull();
      expect(
        declarado ?? 0,
        `${vhost}: client_max_body_size debe ser ≥ ${tope}m`,
      ).toBeGreaterThanOrEqual(tope);
    }
  });
});
