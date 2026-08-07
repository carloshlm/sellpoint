import { RedisModule } from "./redis.module";

describe("RedisModule", () => {
  it("cierra la conexión de Redis en onModuleDestroy (sin esto, jest/el proceso nunca terminan — handle abierto)", async () => {
    const redisMock = { quit: jest.fn().mockResolvedValue("OK") };
    const module = new RedisModule(redisMock as never);

    await module.onModuleDestroy();

    expect(redisMock.quit).toHaveBeenCalledTimes(1);
  });
});
