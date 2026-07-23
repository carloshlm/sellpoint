import { Test, type TestingModule } from "@nestjs/testing";
import { AppController } from "./app.controller";
import { AppModule } from "./app.module";
import { AppService } from "./app.service";
import { HealthController } from "./health/health.controller";
import { PrismaService } from "./infrastructure/prisma/prisma.service";
import { REDIS_CLIENT } from "./infrastructure/redis/redis.module";

describe("AppController", () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe("root", () => {
    it('should return "Hello World!"', () => {
      expect(appController.getHello()).toBe("Hello World!");
    });
  });
});

describe("Smoke: AppModule", () => {
  let app: TestingModule;

  beforeAll(async () => {
    process.env.DATABASE_URL ??= "postgresql://sellpoint:sellpoint@localhost:5432/sellpoint_dev";
    process.env.REDIS_URL ??= "redis://localhost:6379";

    app = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({ $queryRaw: jest.fn().mockResolvedValue([{ "?column?": 1 }]) })
      .overrideProvider(REDIS_CLIENT)
      .useValue({ ping: jest.fn().mockResolvedValue("PONG") })
      .compile();
  });

  afterAll(async () => {
    await app.close();
  });

  it("compila el módulo completo con toda la DI cableada", () => {
    expect(app.get(AppController)).toBeDefined();
    expect(app.get(HealthController)).toBeDefined();
  });

  it("el health responde ok con las dependencias sanas", async () => {
    await expect(app.get(HealthController).getHealth()).resolves.toEqual({
      status: "ok",
      db: "ok",
      redis: "ok",
    });
  });
});
