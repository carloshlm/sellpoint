import * as argon2 from "argon2";
import { ARGON2_OPTIONS, Argon2Hasher } from "./argon2.hasher";

describe("Argon2Hasher", () => {
  describe("canario de infra (f1-auth R5/AD-1 del design)", () => {
    it("usa exactamente {type: argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1}", () => {
      // Si alguien sube memoryCost (ej. al default de 65536), este test
      // rompe ANTES de que la api se OOM-kilee en prod: mem_limit: 512M del
      // compose contempla 19456, no más.
      expect(ARGON2_OPTIONS).toEqual({
        type: argon2.argon2id,
        memoryCost: 19456,
        timeCost: 2,
        parallelism: 1,
      });
    });
  });

  it("hash/verify hacen roundtrip correcto", async () => {
    const hasher = new Argon2Hasher();

    const hash = await hasher.hash("password-de-prueba-123");

    await expect(hasher.verify(hash, "password-de-prueba-123")).resolves.toBe(true);
    await expect(hasher.verify(hash, "otra-password-cualquiera")).resolves.toBe(false);
  });

  it("el hash generado codifica los parámetros del contrato duro", async () => {
    const hasher = new Argon2Hasher();

    const hash = await hasher.hash("password-de-prueba-123");

    expect(hash).toContain("m=19456");
    expect(hash).toContain("t=2");
    expect(hash).toContain("p=1");
  });
});
