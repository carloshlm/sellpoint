import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import config from "../astro.config";

// F11-SITE-BASE-01 — las dos promesas del andamiaje, como barrera: el sitio
// sale 100% estático y no carga un framework de interfaz «por si acaso». El
// día que una isla pida React de verdad, esta prueba se cambia a propósito y
// no por accidente.
const UI_FRAMEWORKS = ["react", "preact", "vue", "svelte", "solid-js", "lit", "alpinejs"];

describe("andamiaje de apps/site", () => {
  it("la salida es estática", () => {
    expect(config.output).toBe("static");
  });

  it("no lleva adaptador de servidor", () => {
    expect(config.adapter).toBeUndefined();
  });

  it("no registra integraciones de frameworks de interfaz", () => {
    const names = (config.integrations ?? []).flat().map((i) => (i ? i.name : ""));
    for (const framework of UI_FRAMEWORKS) {
      expect(names.some((name) => name.includes(framework))).toBe(false);
    }
  });

  it("no depende de ningún framework de interfaz", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    for (const framework of UI_FRAMEWORKS) {
      expect(deps.filter((d) => d === framework || d === `@astrojs/${framework}`)).toEqual([]);
    }
  });
});
