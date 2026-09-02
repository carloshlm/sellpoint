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
    await this.assertRolNoSaltaRls();
  }

  /**
   * El rol de conexión NO puede saltarse RLS (f1-auth R1/U1-12).
   *
   * Todo el aislamiento entre negocios descansa en las policies de RLS, y
   * Postgres se las salta enteras para un rol `SUPERUSER` o `BYPASSRLS`. Con
   * `DATABASE_URL` apuntando a uno de esos, la API arranca sin una sola queja
   * y cada consulta ve las filas de TODOS los negocios: no es un permiso de
   * más, es el multi-tenant apagado.
   *
   * Y falla en silencio, que es lo peor. El 2026-08-31, en el entorno local
   * de Carlos, un negocio recién creado —sin un solo movimiento— recibió un
   * 403 de "ya tienes transacciones registradas": el contador estaba viendo
   * los movimientos de los demás. El síntoma no se parecía en nada a la
   * causa.
   *
   * Por eso se verifica al ARRANCAR y se cae con un mensaje que dice qué
   * hacer. Un `.env` viejo tiene que romper el arranque, no el aislamiento.
   */
  private async assertRolNoSaltaRls(): Promise<void> {
    const roles = await this.$queryRaw<
      { rolname: string; rolsuper: boolean; rolbypassrls: boolean }[]
    >`SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;

    const rol = roles[0];
    if (!rol || !(rol.rolsuper || rol.rolbypassrls)) {
      return;
    }

    const privilegio = rol.rolsuper ? "SUPERUSER" : "BYPASSRLS";
    throw new Error(
      `DATABASE_URL conecta como "${rol.rolname}", que tiene ${privilegio} y por lo ` +
        "tanto se salta el RLS: la API vería los datos de todos los negocios mezclados. " +
        "Apunta DATABASE_URL al rol de la aplicación (sellpoint_app, ver .env.example); " +
        "el rol con privilegios va en DATABASE_URL_ADMIN, que solo usan las migraciones.",
    );
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
   * existe únicamente en las 4 tablas de billing y en `tenant_modules`
   * (F9-MOD-02, la lista de negocios lee los módulos de todos) — un SELECT a `sales` o
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
