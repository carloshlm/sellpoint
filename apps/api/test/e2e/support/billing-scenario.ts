import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import request from "supertest";
import type { App } from "supertest/types";
import type { PrismaService } from "../../../src/infrastructure/prisma/prisma.service";
import { MAILER } from "../../../src/modules/mail/mailer.port";
import type { NoopMailer } from "../../../src/modules/mail/noop.mailer";
import { extractTokenFromLink } from "./extract-token-from-link";

/**
 * Piezas compartidas por los seis e2e de la Fase 7 (F7-E2E-01..06).
 *
 * Los specs de fases anteriores duplican su propio `registerAndLogin` porque
 * cada uno necesitaba un matiz distinto. Acá el alta es IDÉNTICA en los seis
 * archivos y además hace falta una segunda ceremonia —el dueño de la
 * plataforma— que tiene una trampa propia (ver `makePlatformAdmin`): repetir
 * eso seis veces sería copiar seis veces la misma explicación.
 */

export const BILLING_TEST_PASSWORD = "twelve-characters";

export interface TenantFixture {
  /** Access token del owner (Admin del tenant, con todos los permisos). */
  token: string;
  tenantId: string;
  userId: string;
  email: string;
}

export const bearer = (token: string): string => `Bearer ${token}`;

/**
 * Un negocio nuevo por el camino REAL: registro → verificación → login. Nace
 * en trial Plus de 14 días (F7-CORE-03, misma transacción que el provisioning)
 * y **sin país**: `tenants.country` se llena en el onboarding, así que quien
 * necesite el precio de un mercado concreto lo fija con `setTenantMarket`.
 */
export async function registerTenant(
  app: INestApplication<App>,
  prefix = "billing",
): Promise<TenantFixture> {
  const email = `${prefix}-${randomUUID()}@example.com`;

  const registro = await request(app.getHttpServer())
    .post("/auth/register-tenant")
    .send({
      tenantName: `Negocio ${prefix} ${randomUUID().slice(0, 8)}`,
      email,
      password: BILLING_TEST_PASSWORD,
      firstName: "Ana",
      lastNamePaternal: "Pérez",
      locale: "es",
    })
    .expect(201);

  const mailer = app.get<NoopMailer>(MAILER);
  const token = extractTokenFromLink(mailer.sent.find((m) => m.to === email)?.vars.link);
  await request(app.getHttpServer()).post("/auth/verify-email").send({ token }).expect(200);

  const login = await request(app.getHttpServer())
    .post("/auth/login")
    .send({ email, password: BILLING_TEST_PASSWORD })
    .expect(200);

  const { tenantId, userId } = registro.body as { tenantId: string; userId: string };
  return { token: (login.body as { accessToken: string }).accessToken, tenantId, userId, email };
}

/**
 * Convierte un fixture en el DUEÑO DE LA PLATAFORMA — las cuatro llaves del
 * `PlatformAdminGuard`: flag en la fila, email en la whitelist del env,
 * status active y email verificado (las dos últimas ya las trae el registro).
 *
 * ⚠ La whitelist se prende con `ConfigService#set()` y NO con `process.env`:
 * `ConfigModule.forRoot()` valida y CONGELA el entorno en el instante en que
 * `AppModule` se importa —antes de cualquier `beforeAll`—, así que mutar
 * `process.env` después no tiene efecto. `set()` escribe en `internalConfig`,
 * que `get()` consulta ANTES del env validado. Misma técnica que
 * `auth-throttling.e2e-spec.ts` con `THROTTLE_ENABLED`.
 *
 * Como la whitelist es una sola cadena, el ÚLTIMO en llamar a esta función es
 * el único admin vigente: los specs registran su admin una vez, en el
 * `beforeAll`.
 */
export async function makePlatformAdmin(
  app: INestApplication<App>,
  prisma: PrismaService,
  fixture: TenantFixture,
): Promise<void> {
  await prisma.withTenantContext(fixture.tenantId, (tx) =>
    tx.user.update({ where: { id: fixture.userId }, data: { isPlatformAdmin: true } }),
  );
  app.get(ConfigService).set("BILLING_ADMIN_EMAILS", fixture.email);
}

/**
 * El mercado del negocio. El precio se resuelve por PAÍS (no por tipo de
 * cambio): la fila del país del tenant, con la tarifa `US` como fallback
 * internacional — por eso un tenant sin onboarding cobraría en USD.
 */
export function setTenantMarket(
  prisma: PrismaService,
  tenantId: string,
  country: "MX" | "US" | "CA",
): Promise<unknown> {
  const currency = country === "MX" ? "MXN" : country === "US" ? "USD" : "CAD";
  return prisma.tenant.update({ where: { id: tenantId }, data: { country, currency } });
}

/** Un producto vendible (con su presentación base) creado por HTTP. */
export async function crearProducto(
  app: INestApplication<App>,
  token: string,
  precio = 15,
): Promise<{ id: string; sku: string }> {
  const sku = `BILL-${randomUUID().slice(0, 8)}`;
  const creado = await request(app.getHttpServer())
    .post("/products")
    .set("Authorization", bearer(token))
    .send({ sku, name: "Paracetamol 500mg", baseUnit: "unit", price: precio })
    .expect(201);
  return { id: (creado.body as { id: string }).id, sku };
}

/** Carga stock por el camino real: documento de entrada confirmado. */
export async function cargarStock(
  app: INestApplication<App>,
  token: string,
  warehouseId: string,
  productId: string,
  cantidad: number,
): Promise<void> {
  const doc = await request(app.getHttpServer())
    .post("/inventory/documents")
    .set("Authorization", bearer(token))
    .send({ type: "entry", warehouseId })
    .expect(201);
  const docId = (doc.body as { id: string }).id;

  await request(app.getHttpServer())
    .patch(`/inventory/documents/${docId}`)
    .set("Authorization", bearer(token))
    .send({ reasonCode: "adjustment", reasonNote: "carga inicial" })
    .expect(200);
  await request(app.getHttpServer())
    .post(`/inventory/documents/${docId}/lines`)
    .set("Authorization", bearer(token))
    .send({ productId, quantity: cantidad })
    .expect(201);
  await request(app.getHttpServer())
    .post(`/inventory/documents/${docId}/confirm`)
    .set("Authorization", bearer(token))
    .send({})
    .expect(201);
}

/** El almacén inicial del tenant, que `provision()` le asigna al owner. */
export async function almacenInicial(prisma: PrismaService, tenantId: string): Promise<string> {
  const almacen = await prisma.withTenantContext(tenantId, (tx) =>
    tx.warehouse.findFirstOrThrow({ select: { id: true } }),
  );
  return almacen.id;
}
