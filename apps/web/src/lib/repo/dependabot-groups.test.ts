import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * BARRERA: ninguna dependencia `0.x` puede viajar dentro del grupo
 * "minor-y-patch" de Dependabot.
 *
 * **El porqué, que es lo único que importa acá:** semver dice que mientras la
 * versión mayor sea 0, *cualquier* cambio puede romper — el hueco del minor
 * ES el hueco del major. Dependabot agrupa por semver y lee `0.2 → 0.3` como
 * "minor", así que barre un cambio incompatible dentro de un PR con otros
 * veintipico. Eso ya pasó: `pdfmake ^0.2.23 → ^0.3.11` reventó la DI del
 * módulo entero (`pdfmake_1.default is not a constructor`).
 *
 * Excluirlas del grupo no las congela: siguen llegando, pero **cada una en su
 * propio PR**, que es donde se puede mirar el changelog antes de decir que sí.
 *
 * Este test existe porque la lista de exclusiones se pudre sola: el día que
 * alguien agregue una dependencia `0.x` nueva, nadie se va a acordar de
 * sumarla. Que se acuerde el CI.
 */
const RAIZ = join(__dirname, "../../../../..");

const MANIFIESTOS = [
  "package.json",
  "apps/api/package.json",
  "apps/web/package.json",
  "packages/shared/package.json",
] as const;

/** Los nombres de todo lo declarado con un rango que empieza en `0.`. */
function dependenciasCeroX(): string[] {
  const encontradas = new Set<string>();
  for (const manifiesto of MANIFIESTOS) {
    const json = JSON.parse(readFileSync(join(RAIZ, manifiesto), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    for (const bloque of [json.dependencies, json.devDependencies]) {
      for (const [nombre, rango] of Object.entries(bloque ?? {})) {
        if (/^[\^~>=< ]*0\./.test(rango)) encontradas.add(nombre);
      }
    }
  }
  return [...encontradas].sort();
}

/** Las `exclude-patterns` del grupo, leídas del yml sin traer un parser. */
function excluidasDelGrupo(): string[] {
  const yml = readFileSync(join(RAIZ, ".github/dependabot.yml"), "utf8");
  const bloque = /exclude-patterns:\s*\n((?:\s*-\s*"[^"]+"\s*\n)+)/.exec(yml);
  const cuerpo = bloque?.[1];
  if (!cuerpo) return [];
  return [...cuerpo.matchAll(/-\s*"([^"]+)"/g)]
    .map((m) => m[1])
    .filter((nombre): nombre is string => nombre !== undefined)
    .sort();
}

describe("Dependabot: las 0.x no viajan agrupadas (LEY de semver)", () => {
  it("toda dependencia 0.x está excluida del grupo minor-y-patch", () => {
    const sinExcluir = dependenciasCeroX().filter((d) => !excluidasDelGrupo().includes(d));

    expect(
      sinExcluir,
      `Estas dependencias son 0.x y pueden romper en un "minor", pero viajarían ` +
        `dentro del grupo minor-y-patch:\n  ${sinExcluir.join("\n  ")}\n\n` +
        `Agrégalas a exclude-patterns en .github/dependabot.yml para que lleguen ` +
        `en su propio PR.`,
    ).toEqual([]);
  });

  /**
   * La otra mitad: una exclusión que ya no corresponde a ninguna 0.x es
   * basura que confunde a quien lea el yml dentro de un año.
   */
  it("no sobran exclusiones de paquetes que ya no son 0.x", () => {
    const ceroX = dependenciasCeroX();

    expect(excluidasDelGrupo().filter((e) => !ceroX.includes(e))).toEqual([]);
  });
});
