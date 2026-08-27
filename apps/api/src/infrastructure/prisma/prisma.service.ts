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

  /**
   * Variante de `withTenantContext` para el ÚNICO caso donde el tenant NO
   * existe todavía al abrir la transacción: registro de tenant nuevo
   * (f1-auth design §4, `TenantsService.provision()`). El callback recibe
   * `setTenantContext(tenantId)` y DEBE llamarlo justo después de crear el
   * tenant, antes de tocar cualquier tabla con RLS — `set_config` sigue
   * viviendo únicamente acá (regla dura de AD-1), nunca inline en el
   * dominio.
   */
  async withNewTenantContext<T>(
    fn: (
      tx: Prisma.TransactionClient,
      setTenantContext: (tenantId: string) => Promise<void>,
    ) => Promise<T>,
  ): Promise<T> {
    return this.$transaction(
      async (tx) => {
        const setTenantContext = async (tenantId: string) => {
          await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}::text, true)`;
        };
        return fn(tx, setTenantContext);
      },
      { timeout: 10_000 },
    );
  }

  /**
   * F7-DB-05: la ÚNICA puerta cross-tenant del sistema. Solo la usan el cron
   * de billing y el backoffice del dueño (PlatformAdminGuard).
   *
   * NO abre acceso a las tablas de negocio: la policy `billing_admin_bypass`
   * existe únicamente en las 4 tablas de billing — un SELECT a `sales` o
   * `warehouses` desde acá sigue devolviendo cero filas (fijado por test de
   * integración). El GUC es transaction-local por la misma razón que el de
   * tenant: con pooling, una conexión reutilizada jamás lo hereda.
   *
   * Regla dura (hermana de AD-1): `set_config('app.billing_admin', ...)`
   * fuera de este método está prohibido.
   */
  async withBillingAdminContext<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.billing_admin', 'on', true)`;
        return fn(tx);
      },
      { timeout: 10_000 },
    );
  }
}
