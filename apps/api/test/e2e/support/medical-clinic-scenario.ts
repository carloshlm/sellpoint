import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import type { App } from "supertest/types";
import type { PrismaService } from "../../../src/infrastructure/prisma/prisma.service";
import { MAILER } from "../../../src/modules/mail/mailer.port";
import type { NoopMailer } from "../../../src/modules/mail/noop.mailer";
import {
  BILLING_TEST_PASSWORD,
  bearer,
  makePlatformAdmin,
  registerTenant,
  setTenantMarket,
  type TenantFixture,
} from "./billing-scenario";
import { extractTokenFromLink } from "./extract-token-from-link";

/**
 * F9-CLINIC-18/19/20 — el escenario del consultorio: un admin de plataforma
 * que activa módulos por el endpoint REAL del backoffice, y negocios con
 * Recepción y Consultorio Médico encendidos.
 */
export async function activarModulo(
  app: INestApplication<App>,
  admin: TenantFixture,
  tenantId: string,
  moduleKey: "reception" | "medical_clinic",
): Promise<void> {
  await request(app.getHttpServer())
    .post(`/admin/billing/tenants/${tenantId}/modules`)
    .set("Authorization", bearer(admin.token))
    .send({ moduleKey, customPrice: "1250.00", reason: "e2e" })
    .expect(201);
}

export async function consultorio(
  app: INestApplication<App>,
  prisma: PrismaService,
  prefix: string,
  admin: TenantFixture,
  modulos: ("reception" | "medical_clinic")[] = ["reception", "medical_clinic"],
): Promise<TenantFixture & { warehouseId: string }> {
  const negocio = await registerTenant(app, prefix);
  await setTenantMarket(prisma, negocio.tenantId, "MX");
  for (const m of modulos) {
    await activarModulo(app, admin, negocio.tenantId, m);
  }
  // El almacén asignado del médico: sin él no hay stock que recetar ni cotizar.
  const warehouseId = await prisma.withTenantContext(negocio.tenantId, async (tx) => {
    const almacen = await tx.warehouse.findFirstOrThrow({ select: { id: true } });
    await tx.user.updateMany({
      where: { tenantId: negocio.tenantId },
      data: { defaultWarehouseId: almacen.id },
    });
    return almacen.id;
  });
  return { ...negocio, warehouseId };
}

export async function adminDePlataforma(
  app: INestApplication<App>,
  prisma: PrismaService,
  prefix: string,
): Promise<TenantFixture> {
  const admin = await registerTenant(app, prefix);
  await makePlatformAdmin(app, prisma, admin);
  return admin;
}

/** Un usuario invitado con un rol dado (Viewer, Manager…), ya logueado. */
export async function usuarioConRol(
  app: INestApplication<App>,
  owner: TenantFixture,
  rol: string,
  prefix: string,
): Promise<string> {
  const roles = await request(app.getHttpServer())
    .get("/roles")
    .set("Authorization", bearer(owner.token))
    .expect(200);
  const elegido = (roles.body as { id: string; name: string }[]).find((r) => r.name === rol);
  const email = `${prefix}-${randomUUID()}@example.com`;
  await request(app.getHttpServer())
    .post("/users")
    .set("Authorization", bearer(owner.token))
    .send({ email, firstName: "Vera", lastNamePaternal: "Vista", roleIds: [elegido?.id] })
    .expect(201);
  const mailer = app.get<NoopMailer>(MAILER);
  const token = extractTokenFromLink(mailer.sent.filter((m) => m.to === email).at(-1)?.vars.link);
  await request(app.getHttpServer())
    .post("/auth/reset-password")
    .send({ token, password: BILLING_TEST_PASSWORD })
    .expect(204);
  const login = await request(app.getHttpServer())
    .post("/auth/login")
    .send({ email, password: BILLING_TEST_PASSWORD })
    .expect(200);
  return (login.body as { accessToken: string }).accessToken;
}
