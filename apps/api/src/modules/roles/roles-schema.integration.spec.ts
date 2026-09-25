import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { type Prisma, PrismaClient } from "../../generated/prisma/client";
import { TENANT_ROLES } from "../tenants/role-catalog";

const MIGRATION = join(
  __dirname,
  "../../../prisma/migrations/20261001120000_f10_manfix_role_system_key/migration.sql",
);

/** Lanzarla dentro de la transacción del replay es lo que la revierte. */
class Revertir extends Error {}

interface Foto {
  roles: { tenantId: string; name: string; systemKey: string | null }[];
  renombres: { tenantId: string; before: unknown; after: unknown }[];
}

/**
 * Integration (Postgres real) — F10-MANFIX-22: la clave fija de los roles de
 * fábrica (`roles.system_key`) y su nombre en el idioma del negocio.
 *
 * Fija dos cosas:
 *  - LA FORMA: la columna solo admite las cuatro claves (CHECK) y un negocio
 *    tiene a lo sumo un rol por clave (índice único parcial), sin estorbar a
 *    los roles personalizados, que la llevan en NULL;
 *  - EL BACKFILL: los negocios que ya existían reciben la clave en sus roles
 *    de fábrica —también en el que ya habían renombrado— y el nombre en el
 *    idioma del dueño, sin pisar un nombre cambiado ni chocar con un rol propio.
 *
 * El backfill se reproduce con el rol admin (salta RLS), como el de impuestos,
 * pero DENTRO de una transacción que se revierte al final: sus UPDATE recorren
 * toda la base de pruebas, y un spec corriendo en paralelo vería los roles de
 * sus negocios cambiar de nombre a medio camino (la trampa que ya mordió al
 * backfill de impuestos, ver `taxes-schema.integration.spec.ts`).
 */
describe("roles.system_key: la clave fija de los roles de fábrica (F10-MANFIX-22)", () => {
  let admin: PrismaClient;
  const stamp = Date.now();
  const sql = readFileSync(MIGRATION, "utf8");
  const sentencias = sql
    .split(/;\s*\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.split("\n").every((l) => l.startsWith("--")));
  /** Solo las de DATOS: la columna, el CHECK y el índice ya los aplicó `migrate deploy`. */
  const deDatos = sentencias.filter((s) =>
    /^(WITH|UPDATE|INSERT)\b/.test(
      s
        .split("\n")
        .filter((l) => !l.trimStart().startsWith("--"))
        .join("\n")
        .trim(),
    ),
  );
  const negocios: Record<string, string> = {};
  let primera: Foto;
  let segunda: Foto;

  const replay = async (tx: Prisma.TransactionClient) => {
    for (const sentencia of deDatos) {
      await tx.$executeRawUnsafe(sentencia);
    }
  };

  const foto = async (tx: Prisma.TransactionClient): Promise<Foto> => {
    const ids = Object.values(negocios);
    const roles = await tx.role.findMany({
      where: { tenantId: { in: ids } },
      select: { tenantId: true, name: true, systemKey: true },
    });
    const renombres = await tx.auditLog.findMany({
      where: { tenantId: { in: ids }, action: "role.name_localized" },
      select: { tenantId: true, before: true, after: true },
    });
    return { roles, renombres };
  };

  /** Los roles de un negocio como { nombre: clave }: no depende del orden de creación. */
  const rolesDe = (f: Foto, negocio: string) =>
    Object.fromEntries(
      f.roles.filter((r) => r.tenantId === negocios[negocio]).map((r) => [r.name, r.systemKey]),
    );

  /** Un negocio en el estado de ANTES de la migración: roles con nombre y sin clave. */
  async function sembrar(
    escenario: string,
    opciones: { locale?: "es" | "en"; roles: string[] },
  ): Promise<Record<string, string>> {
    const tenantId = (await admin.tenant.create({ data: { name: `Roles ${escenario} ${stamp}` } }))
      .id;
    negocios[escenario] = tenantId;
    if (opciones.locale) {
      await admin.user.create({
        data: {
          tenantId,
          email: `roles-${escenario}-${stamp}@example.com`,
          firstName: "Ana",
          lastName: "Pérez",
          locale: opciones.locale,
        },
      });
    }
    const ids: Record<string, string> = {};
    // En serie a propósito: el orden de alta es el de `provision()`.
    for (const name of opciones.roles) {
      ids[name] = (await admin.role.create({ data: { tenantId, name } })).id;
    }
    return ids;
  }

  /** Lo que deja `RolesService`: un renombre auditado, o el alta de un rol propio. */
  const auditar = (
    tenantId: string,
    roleId: string,
    action: "role.created" | "role.updated",
    before: string | null,
    after: string,
  ) =>
    admin.auditLog.create({
      data: {
        tenantId,
        action,
        resourceType: "role",
        resourceId: roleId,
        ...(before === null ? {} : { before: { name: before, permissionCodes: [] } }),
        after: { name: after, permissionCodes: [] },
      },
    });

  beforeAll(async () => {
    const url = process.env.DATABASE_URL_ADMIN ?? process.env.DATABASE_URL;
    if (!url) throw new Error("Falta DATABASE_URL_ADMIN para replayar la migración");
    admin = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

    await sembrar("es", { locale: "es", roles: ["Admin", "Manager", "Seller", "Viewer"] });
    await sembrar("en", { locale: "en", roles: ["Admin", "Manager", "Seller", "Viewer"] });

    // Renombró su «Seller» por el API ANTES de esta migración: el nombre ya no
    // dice que es de fábrica, pero la auditoría sí.
    const renombrado = await sembrar("renombrado", {
      locale: "es",
      roles: ["Admin", "Manager", "Mostrador", "Viewer"],
    });
    await auditar(
      negocios.renombrado as string,
      renombrado.Mostrador as string,
      "role.updated",
      "Seller",
      "Mostrador",
    );

    // Tiene un rol PROPIO que ya se llama como el nuevo nombre del cajero.
    const choque = await sembrar("choque", {
      locale: "es",
      roles: ["Admin", "Manager", "Seller", "Viewer", "Cajero"],
    });
    await auditar(
      negocios.choque as string,
      choque.Cajero as string,
      "role.created",
      null,
      "Cajero",
    );

    // Nació antes del 2026-08-26 y la guarda de ese día le dejó el nombre
    // viejo, porque ya había creado su propio «Admin».
    const legado = await sembrar("legado", {
      locale: "es",
      roles: ["TenantAdmin", "Manager", "POS_Seller", "Viewer", "Admin"],
    });
    await auditar(negocios.legado as string, legado.Admin as string, "role.created", null, "Admin");

    // Sin usuarios no hay dueño que diga el idioma.
    await sembrar("sinDueno", { roles: ["Admin", "Seller"] });

    await admin
      .$transaction(
        async (tx) => {
          await replay(tx);
          primera = await foto(tx);
          await replay(tx);
          segunda = await foto(tx);
          throw new Revertir();
        },
        { maxWait: 30_000, timeout: 120_000 },
      )
      .catch((error: unknown) => {
        if (!(error instanceof Revertir)) throw error;
      });
  });

  afterAll(async () => {
    // Se borran con la única definición de «eliminar un negocio» del sistema.
    for (const tenantId of Object.values(negocios)) {
      await admin.tenant.update({
        where: { id: tenantId },
        data: { suspendedAt: new Date(), suspendedReason: "fin del spec" },
      });
      await admin.$queryRaw`SELECT purge_tenant(${tenantId}::uuid)`;
    }
    await admin.$disconnect();
  });

  describe("la forma de la columna", () => {
    it("cada clave de TENANT_ROLES pasa el CHECK y una clave inventada rebota", async () => {
      const tenantId = (await admin.tenant.create({ data: { name: `Roles check ${stamp}` } })).id;
      negocios.check = tenantId;
      for (const rol of TENANT_ROLES) {
        await admin.role.create({ data: { tenantId, name: rol.name.es, systemKey: rol.key } });
      }
      await expect(
        admin.role.create({ data: { tenantId, name: "Dueño", systemKey: "owner" } }),
      ).rejects.toThrow(/roles_system_key_check/);
    });

    it("un negocio tiene a lo sumo un rol por clave; los personalizados (NULL) no chocan y la misma clave vive en otro negocio", async () => {
      const a = (await admin.tenant.create({ data: { name: `Roles único A ${stamp}` } })).id;
      const b = (await admin.tenant.create({ data: { name: `Roles único B ${stamp}` } })).id;
      negocios.unicoA = a;
      negocios.unicoB = b;
      await admin.role.create({ data: { tenantId: a, name: "Administrador", systemKey: "admin" } });
      await expect(
        admin.role.create({ data: { tenantId: a, name: "Otro admin", systemKey: "admin" } }),
      ).rejects.toThrow(/roles_tenant_id_system_key_key|Unique constraint/);
      await admin.role.create({ data: { tenantId: a, name: "Propio 1" } });
      await admin.role.create({ data: { tenantId: a, name: "Propio 2" } });
      await admin.role.create({ data: { tenantId: b, name: "Administrador", systemKey: "admin" } });
      expect(await admin.role.count({ where: { tenantId: { in: [a, b] } } })).toBe(4);
    });
  });

  describe("el backfill de los negocios que ya existían", () => {
    it("la migración es SQL de conjunto: ninguna sentencia es un bloque DO", () => {
      expect(sql).not.toMatch(/DO \$\$/);
      expect(deDatos).toHaveLength(2);
    });

    it("un negocio en español: sus cuatro roles de fábrica ganan la clave y el nombre en español", () => {
      expect(rolesDe(primera, "es")).toEqual(
        Object.fromEntries(TENANT_ROLES.map((rol) => [rol.name.es, rol.key])),
      );
      expect(rolesDe(primera, "es")).toEqual({
        Administrador: "admin",
        Encargado: "manager",
        Cajero: "seller",
        Consulta: "viewer",
      });
    });

    it("un negocio en inglés: Admin, Manager y Viewer se quedan y Seller pasa a Cashier", () => {
      expect(rolesDe(primera, "en")).toEqual(
        Object.fromEntries(TENANT_ROLES.map((rol) => [rol.name.en, rol.key])),
      );
      expect(rolesDe(primera, "en")).toEqual({
        Admin: "admin",
        Manager: "manager",
        Cashier: "seller",
        Viewer: "viewer",
      });
    });

    it("un rol de fábrica que el negocio ya había renombrado conserva su nombre y gana la clave por su rastro en la auditoría", () => {
      expect(rolesDe(primera, "renombrado")).toEqual({
        Administrador: "admin",
        Encargado: "manager",
        Mostrador: "seller",
        Consulta: "viewer",
      });
    });

    it("un rol propio llamado «Cajero» no choca: el de fábrica gana la clave y conserva «Seller», y el propio queda sin clave", () => {
      expect(rolesDe(primera, "choque")).toEqual({
        Administrador: "admin",
        Encargado: "manager",
        Seller: "seller",
        Consulta: "viewer",
        Cajero: null,
      });
    });

    it("los nombres viejos del 2026-08-26 también son de fábrica, y un rol propio llamado «Admin» no se lleva la clave", () => {
      expect(rolesDe(primera, "legado")).toEqual({
        Administrador: "admin",
        Encargado: "manager",
        Cajero: "seller",
        Consulta: "viewer",
        Admin: null,
      });
    });

    it("sin usuarios no hay dueño que diga el idioma: se nombra en español", () => {
      expect(rolesDe(primera, "sinDueno")).toEqual({ Administrador: "admin", Cajero: "seller" });
    });

    it("cada renombre queda en la auditoría como role.name_localized, con el nombre de antes y el de después", () => {
      const delEspanol = primera.renombres.filter((r) => r.tenantId === negocios.es);
      expect(delEspanol).toHaveLength(4);
      expect(delEspanol).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ before: { name: "Seller" }, after: { name: "Cajero" } }),
          expect.objectContaining({ before: { name: "Viewer" }, after: { name: "Consulta" } }),
        ]),
      );
      // Lo que no cambió de nombre no deja renglón: en inglés solo Seller.
      expect(primera.renombres.filter((r) => r.tenantId === negocios.en)).toEqual([
        expect.objectContaining({ before: { name: "Seller" }, after: { name: "Cashier" } }),
      ]);
    });

    it("es idempotente: la segunda corrida no cambia nada ni duplica la auditoría", () => {
      const orden = (f: Foto) =>
        [...f.roles].sort((x, y) =>
          `${x.tenantId}${x.name}`.localeCompare(`${y.tenantId}${y.name}`),
        );
      expect(orden(segunda)).toEqual(orden(primera));
      expect(segunda.renombres).toHaveLength(primera.renombres.length);
    });
  });
});
