// Seed de desarrollo: tenant Demo + admin + roles base + catálogo de permisos.
// Corre como ADMIN (DATABASE_URL_ADMIN): bypasear RLS acá es correcto — el
// seed escribe datos de un tenant sin pasar por el contexto de la app.
// Idempotente: upserts con IDs/claves fijas — correrlo N veces no duplica.
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import * as argon2 from "argon2";
import { PrismaClient } from "../src/generated/prisma/client";

const DEMO_TENANT_ID = "00000000-0000-4000-8000-000000000001";
const DEMO_ADMIN_EMAIL = "admin@demo.sellpoint.mx";
// Password conocido SOLO para dev/demo — jamás usar en un tenant real
const DEMO_ADMIN_PASSWORD = "Demo1234!";

// Catálogo global de permisos: code = "modulo:accion"
const PERMISSIONS = [
  { code: "users:read", module: "users", description: "Ver usuarios" },
  { code: "users:manage", module: "users", description: "Crear, editar, suspender usuarios" },
  { code: "roles:read", module: "roles", description: "Ver roles y permisos" },
  { code: "roles:manage", module: "roles", description: "Crear y editar roles" },
  { code: "products:read", module: "products", description: "Ver catálogo" },
  { code: "products:manage", module: "products", description: "Editar catálogo" },
  { code: "inventory:read", module: "inventory", description: "Ver stock y movimientos" },
  { code: "inventory:manage", module: "inventory", description: "Registrar movimientos" },
  { code: "pos:sell", module: "pos", description: "Operar el punto de venta" },
  { code: "reports:read", module: "reports", description: "Ver reportes" },
  {
    code: "tenants:manage",
    module: "tenants",
    description: "Configurar el perfil del negocio (razón social, dirección, moneda, onboarding)",
  },
] as const;

type PermissionCode = (typeof PERMISSIONS)[number]["code"];

const ALL_CODES = PERMISSIONS.map((p) => p.code);
const READ_CODES = ALL_CODES.filter((c) => c.endsWith(":read"));

// Roles base que se seedean POR tenant
const ROLES: Record<string, readonly PermissionCode[]> = {
  Admin: ALL_CODES,
  // F1-WEB-ONBOARD-01 (D4 del design): tenants:manage tampoco es tarea de
  // Manager, mismo criterio que users:manage/roles:manage.
  Manager: ALL_CODES.filter(
    (c) => c !== "users:manage" && c !== "roles:manage" && c !== "tenants:manage",
  ),
  Seller: ["pos:sell", "products:read"],
  Viewer: READ_CODES,
};

const connectionString = process.env.DATABASE_URL_ADMIN ?? process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("Falta DATABASE_URL_ADMIN (o DATABASE_URL) para el seed");
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function main() {
  // 1. Catálogo global de permisos
  for (const p of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { code: p.code },
      update: { module: p.module, description: p.description },
      create: p,
    });
  }
  console.log(`✓ ${PERMISSIONS.length} permisos`);

  // 2. Tenant Demo
  const tenant = await prisma.tenant.upsert({
    where: { id: DEMO_TENANT_ID },
    update: {},
    create: {
      id: DEMO_TENANT_ID,
      name: "Demo",
      currency: "MXN",
      onboarded: true,
    },
  });
  console.log(`✓ tenant ${tenant.name} (${tenant.currency})`);

  // 3. Roles base con sus permisos
  const allPermissions = await prisma.permission.findMany();
  const byCode = new Map(allPermissions.map((p) => [p.code, p.id]));

  for (const [name, codes] of Object.entries(ROLES)) {
    const role = await prisma.role.upsert({
      where: { tenantId_name: { tenantId: tenant.id, name } },
      update: {},
      create: { tenantId: tenant.id, name },
    });
    // deleteMany+createMany: el set de permisos del rol queda EXACTO al catálogo
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({
      data: codes.map((code) => {
        const permissionId = byCode.get(code);
        if (!permissionId) throw new Error(`Permiso desconocido en el seed: ${code}`);
        return { roleId: role.id, permissionId };
      }),
    });
    console.log(`✓ rol ${name} (${codes.length} permisos)`);
  }

  // 4. Admin demo (active, password conocido, es)
  const passwordHash = await argon2.hash(DEMO_ADMIN_PASSWORD, { type: argon2.argon2id });
  // `upsert` con `tenantId_email` NO compila contra este schema: ese unique
  // compuesto no existe. El unique real de email es un índice FUNCIONAL sobre
  // `lower(email)` que vive a mano en la migración `_auth_login_gateway`
  // (Prisma no soporta índices funcionales), así que no hay `where` único que
  // Prisma acepte — hay que buscar y ramificar. El seed llevaba roto desde que
  // ese índice se volvió funcional; nadie lo notó porque `db seed` solo corre
  // a mano en dev.
  const existente = await prisma.user.findFirst({
    where: { tenantId: tenant.id, email: DEMO_ADMIN_EMAIL },
    select: { id: true },
  });
  const admin = existente
    ? await prisma.user.update({
        where: { id: existente.id },
        data: { passwordHash, status: "active" },
      })
    : await prisma.user.create({
        data: {
          tenantId: tenant.id,
          email: DEMO_ADMIN_EMAIL,
          passwordHash,
          firstName: "Admin",
          lastNamePaternal: "Demo",
          status: "active",
          locale: "es",
          emailVerifiedAt: new Date(),
        },
      });

  const adminRole = await prisma.role.findUniqueOrThrow({
    where: { tenantId_name: { tenantId: tenant.id, name: "Admin" } },
  });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: admin.id, roleId: adminRole.id } },
    update: {},
    create: { userId: admin.id, roleId: adminRole.id },
  });
  console.log(`✓ admin ${admin.email} con rol Admin`);

  // F3-HOME-03: el tenant demo estaba `onboarded: true` SIN un solo almacén —
  // un estado que ningún tenant real puede alcanzar desde que `provision()`
  // crea el suyo. Un seed que produce estados imposibles es un seed que miente.
  const warehouse = await prisma.warehouse.upsert({
    where: { tenantId_name: { tenantId: tenant.id, name: "Almacén Central" } },
    update: {},
    create: { tenantId: tenant.id, name: "Almacén Central" },
  });
  await prisma.user.update({
    where: { id: admin.id },
    data: { defaultWarehouseId: warehouse.id },
  });
  console.log(`✓ almacén ${warehouse.name} asignado a ${admin.email}`);
}

main()
  .then(() => console.log("Seed completo."))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
