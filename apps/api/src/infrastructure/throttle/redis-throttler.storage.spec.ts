import { RedisThrottlerStorage } from "./redis-throttler.storage";

describe("RedisThrottlerStorage", () => {
  function buildStorage(evalResult: [number, number]) {
    const redis = {
      eval: jest.fn().mockResolvedValue(evalResult),
    };
    const storage = new RedisThrottlerStorage(redis as never);
    return { storage, redis };
  }

  it("primer hit: totalHits=1, no bloqueado, timeToExpire=ceil(pttl/1000)", async () => {
    const { storage, redis } = buildStorage([1, 900_000]);

    const record = await storage.increment(
      "throttle:auth-ip:1.2.3.4",
      900_000,
      5,
      900_000,
      "auth-ip",
    );

    expect(record).toEqual({
      totalHits: 1,
      timeToExpire: 900,
      isBlocked: false,
      timeToBlockExpire: 900,
    });
    // Contrato de key (f1-auth design §7/AD-7): la storage usa la key TAL
    // CUAL la recibe — el formato `throttle:{name}:{tracker}` lo arma el
    // guard, no la storage.
    expect(redis.eval).toHaveBeenCalledWith(
      expect.any(String),
      1,
      "throttle:auth-ip:1.2.3.4",
      900_000,
    );
  });

  it("totalHits > limit → isBlocked=true", async () => {
    const { storage } = buildStorage([6, 500_000]);

    const record = await storage.increment(
      "throttle:auth-ip:1.2.3.4",
      900_000,
      5,
      900_000,
      "auth-ip",
    );

    expect(record.totalHits).toBe(6);
    expect(record.isBlocked).toBe(true);
    expect(record.timeToExpire).toBe(500);
  });

  it("totalHits === limit → NO bloqueado (el límite es inclusive, el bloqueo es en el intento SIGUIENTE)", async () => {
    const { storage } = buildStorage([5, 900_000]);

    const record = await storage.increment(
      "throttle:auth-ip:1.2.3.4",
      900_000,
      5,
      900_000,
      "auth-ip",
    );

    expect(record.isBlocked).toBe(false);
  });

  it("redondea timeToExpire hacia arriba (ceil), nunca 0 con TTL residual > 0", async () => {
    const { storage } = buildStorage([1, 1]);

    const record = await storage.increment(
      "throttle:auth-ip:1.2.3.4",
      900_000,
      5,
      900_000,
      "auth-ip",
    );

    expect(record.timeToExpire).toBe(1);
  });

  it("canario: el script Lua solo hace PEXPIRE cuando el hit es el primero (current == 1) — no extiende TTL en hits siguientes", async () => {
    const { storage, redis } = buildStorage([1, 900_000]);
    await storage.increment("k", 900_000, 5, 900_000, "auth-ip");

    const script = redis.eval.mock.calls[0]?.[0] as string;
    expect(script).toMatch(/INCR/i);
    expect(script).toMatch(/current == 1/);
    expect(script).toMatch(/PEXPIRE/i);
    expect(script).toMatch(/PTTL/i);
  });
});
