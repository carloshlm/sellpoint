import { createHash } from "node:crypto";
import { OneTimeTokenService } from "./one-time-token.service";

describe("OneTimeTokenService", () => {
  it("generate() devuelve un token en claro y su sha256 hex como tokenHash", () => {
    const service = new OneTimeTokenService();

    const { token, tokenHash } = service.generate();

    expect(token).toHaveLength(43); // 32 bytes en base64url, sin padding
    expect(tokenHash).toBe(createHash("sha256").update(token).digest("hex"));
  });

  it("dos generate() sucesivos producen tokens distintos", () => {
    const service = new OneTimeTokenService();

    const a = service.generate();
    const b = service.generate();

    expect(a.token).not.toBe(b.token);
    expect(a.tokenHash).not.toBe(b.tokenHash);
  });

  it("hash(token) es determinístico y coincide con el tokenHash de generate()", () => {
    const service = new OneTimeTokenService();

    const { token, tokenHash } = service.generate();

    expect(service.hash(token)).toBe(tokenHash);
    expect(service.hash(token)).toBe(service.hash(token));
  });
});
