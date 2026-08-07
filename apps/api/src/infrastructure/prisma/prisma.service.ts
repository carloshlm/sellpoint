import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { Env } from "../../config/env.schema";
import { Prisma, PrismaClient } from "../../generated/prisma/client";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(configService: ConfigService<Env, true>) {
    super({
      adapter: new PrismaPg({
        connectionString: configService.get("DATABASE_URL", { infer: true }),
      }),
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * ÚNICA forma de abrir contexto de tenant para RLS (f1-auth AD-1).
   *
   * `set_config(..., true)` (tercer argumento `is_local`) es TRANSACTION
   * LOCAL: solo dura mientras la transacción está abierta. Por eso esto es
   * SIEMPRE `$transaction` — con pooling, una conexión reutilizada por otro
   * request nunca hereda el contexto de esta.
   *
   * Regla dura (lint/review): `set_config` fuera de acá está prohibido, y
   * NUNCA anidar un `$transaction` dentro del callback — argon2 (~80-150ms)
   * corre SIEMPRE afuera de esta transacción (ver AuthService).
   */
  async withTenantContext<T>(
    tenantId: string,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}::text, true)`;
        return fn(tx);
      },
      { timeout: 10_000 },
    );
  }
}
