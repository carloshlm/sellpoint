import type { Logger } from "@nestjs/common";
import type { Redis } from "ioredis";
import type { HashPort } from "../../infrastructure/crypto/hash.port";
import { AuthorizationCodeService, authorizationAttemptsKey } from "./authorization-code.service";

/**
 * F10-CASHMOV-02 — la verificación del código de autorización salió de
 * `SalesService.autorizarDescuento` sin cambiar nada: la misma llave de Redis,
 * el mismo tope de cinco intentos por quince minutos, los mismos mensajes y
 * estados, y el mismo aviso en el log con el logger de quien llama.
 */
describe("AuthorizationCodeService (F4-DISC, F10-CASHMOV-02)", () => {
  const user = { tenantId: "t1", userId: "u1", permissions: [], locale: "es" as const };
  const LLAVE = "pos:discount-attempts:t1:u1";
  const redis = { get: jest.fn(), incr: jest.fn(), expire: jest.fn(), del: jest.fn() };
  const hasher = { hash: jest.fn(), verify: jest.fn() };
  const logger = { warn: jest.fn() };
  const service = new AuthorizationCodeService(
    hasher as unknown as HashPort,
    redis as unknown as Redis,
  );
  const verificar = (code: string) =>
    service.verify(user, "hash-del-negocio", code, logger as unknown as Logger);

  beforeEach(() => {
    for (const fn of [...Object.values(redis), ...Object.values(hasher), logger.warn]) {
      fn.mockReset();
    }
    redis.get.mockResolvedValue(null);
  });

  it("la llave es la del descuento, por negocio y persona", () => {
    expect(authorizationAttemptsKey("t1", "u1")).toBe(LLAVE);
  });

  it("el acierto borra la cuenta de intentos", async () => {
    redis.get.mockResolvedValue("3");
    hasher.verify.mockResolvedValue(true);

    await expect(verificar("1234")).resolves.toBeUndefined();

    expect(hasher.verify).toHaveBeenCalledWith("hash-del-negocio", "1234");
    expect(redis.del).toHaveBeenCalledWith(LLAVE);
    expect(redis.incr).not.toHaveBeenCalled();
  });

  it("el código equivocado es 403, suma un intento de quince minutos y avisa en el log", async () => {
    hasher.verify.mockResolvedValue(false);

    await expect(verificar("9999")).rejects.toMatchObject({
      status: 403,
      response: { message: "pos.discount_code_invalid" },
    });

    expect(redis.incr).toHaveBeenCalledWith(LLAVE);
    expect(redis.expire).toHaveBeenCalledWith(LLAVE, 15 * 60);
    expect(logger.warn).toHaveBeenCalledWith(
      { tenantId: "t1", userId: "u1" },
      "pos.discount_code_invalid",
    );
    expect(redis.del).not.toHaveBeenCalled();
  });

  it("con cinco intentos ya es 429 y ni siquiera verifica: aunque sea el bueno", async () => {
    redis.get.mockResolvedValue("5");
    hasher.verify.mockResolvedValue(true);

    await expect(verificar("1234")).rejects.toMatchObject({
      status: 429,
      response: { message: "pos.discount_code_locked" },
    });

    expect(hasher.verify).not.toHaveBeenCalled();
    expect(redis.del).not.toHaveBeenCalled();
  });

  it("con cuatro intentos todavía verifica", async () => {
    redis.get.mockResolvedValue("4");
    hasher.verify.mockResolvedValue(true);

    await expect(verificar("1234")).resolves.toBeUndefined();
  });
});
