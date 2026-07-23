import { ServiceUnavailableException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { PrismaService } from "../infrastructure/prisma/prisma.service";
import { REDIS_CLIENT } from "../infrastructure/redis/redis.module";
import { HealthController } from "./health.controller";

describe("HealthController", () => {
  let controller: HealthController;
  const prismaMock = { $queryRaw: jest.fn() };
  const redisMock = { ping: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: PrismaService, useValue: prismaMock },
        { provide: REDIS_CLIENT, useValue: redisMock },
      ],
    }).compile();

    controller = module.get(HealthController);
  });

  it("devuelve ok cuando db y redis responden", async () => {
    prismaMock.$queryRaw.mockResolvedValue([{ "?column?": 1 }]);
    redisMock.ping.mockResolvedValue("PONG");

    await expect(controller.getHealth()).resolves.toEqual({
      status: "ok",
      db: "ok",
      redis: "ok",
    });
  });

  it("lanza 503 con db en error cuando postgres no responde", async () => {
    prismaMock.$queryRaw.mockRejectedValue(new Error("connection refused"));
    redisMock.ping.mockResolvedValue("PONG");

    const error = await controller.getHealth().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect((error as ServiceUnavailableException).getResponse()).toEqual({
      status: "error",
      db: "error",
      redis: "ok",
    });
  });

  it("lanza 503 con redis en error cuando redis no responde", async () => {
    prismaMock.$queryRaw.mockResolvedValue([{ "?column?": 1 }]);
    redisMock.ping.mockRejectedValue(new Error("timeout"));

    const error = await controller.getHealth().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect((error as ServiceUnavailableException).getResponse()).toEqual({
      status: "error",
      db: "ok",
      redis: "error",
    });
  });
});
