import { ConflictException, UnprocessableEntityException } from "@nestjs/common";
import { Prisma } from "../../generated/prisma/client";
import { SuppliersService } from "./suppliers.service";

/**
 * F9-SUPPL-03 — el catálogo de proveedores.
 *
 * Lo que fija: la búsqueda mira nombre, registro fiscal, contacto, teléfono
 * y correo; el orden es alfabético con desempate por id; el registro fiscal
 * se normaliza y se valida con el PAÍS del negocio (sin país, todo vale);
 * borrar uno referenciado es 409; y todo audita en la misma tx.
 */
const TENANT = "11111111-1111-1111-1111-111111111111";
const USER = { userId: "u-1", tenantId: TENANT, permissions: [], locale: "es" as const };
const META = { ip: "127.0.0.1", userAgent: "jest" };

type Mock = jest.Mock;

const fila = (extra: Record<string, unknown> = {}) => ({
  id: "s-1",
  tenantId: TENANT,
  code: "PROV-001",
  name: "Distribuidora Norte",
  taxId: null,
  contactName: null,
  jobTitle: null,
  phone: null,
  email: null,
  address: null,
  addressLine2: null,
  city: null,
  region: null,
  postalCode: null,
  notes: null,
  attributes: {},
  contacts: [],
  isActive: true,
  createdBy: "u-1",
  updatedBy: "u-1",
  createdAt: new Date("2026-09-10T18:00:00.000Z"),
  updatedAt: new Date("2026-09-10T18:00:00.000Z"),
  ...extra,
});

/**
 * Lo que Prisma devolvería tras un `create`/`update` con `include` de los
 * contactos: el `create` anidado se vuelve la lista con sus ids.
 */
const comoFila = ({ data }: { data: Record<string, unknown> }) => {
  const { contacts, ...resto } = data as { contacts?: { create: Record<string, unknown>[] } };
  return Promise.resolve(
    fila({
      ...resto,
      ...(contacts
        ? {
            contacts: contacts.create.map((c, i) => ({
              id: `c-${i + 1}`,
              ...c,
            })),
          }
        : {}),
    }),
  );
};

const contactoGuardado = (extra: Record<string, unknown> = {}) => ({
  id: "c-viejo",
  tenantId: TENANT,
  supplierId: "s-1",
  sortOrder: 1,
  name: "Pedro",
  phone: null,
  email: null,
  jobTitle: null,
  createdAt: new Date("2026-09-10T18:00:00.000Z"),
  updatedAt: new Date("2026-09-10T18:00:00.000Z"),
  ...extra,
});

const p2003 = () =>
  new Prisma.PrismaClientKnownRequestError("fk", { code: "P2003", clientVersion: "test" });

describe("SuppliersService (F9-SUPPL-03)", () => {
  let tx: {
    supplier: {
      count: Mock;
      findMany: Mock;
      findFirst: Mock;
      create: Mock;
      update: Mock;
      delete: Mock;
    };
    supplierContact: { deleteMany: Mock };
    tenant: { findUniqueOrThrow: Mock };
    /** F9-SUPPCAT-03: la serie PROV-NNN se lee con SQL crudo (MAX de la serie). */
    $queryRaw: Mock;
  };
  let prisma: { withTenantContext: Mock };
  let audit: { record: Mock };
  let service: SuppliersService;

  beforeEach(() => {
    tx = {
      supplier: {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([fila()]),
        findFirst: jest.fn().mockResolvedValue(fila()),
        create: jest.fn().mockImplementation(comoFila),
        update: jest.fn().mockImplementation(comoFila),
        delete: jest.fn().mockResolvedValue(fila()),
      },
      supplierContact: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      tenant: { findUniqueOrThrow: jest.fn().mockResolvedValue({ country: "MX" }) },
      $queryRaw: jest.fn().mockResolvedValue([{ max: null }]),
    };
    prisma = {
      withTenantContext: jest.fn((_t: string, fn: (t: typeof tx) => unknown) => fn(tx)),
    };
    audit = { record: jest.fn() };
    // biome-ignore lint/suspicious/noExplicitAny: mocks parciales a propósito
    service = new SuppliersService(prisma as any, audit as any);
  });

  /**
   * F9-SUPPCAT-03 — el código: `PROV-NNN` por el MAYOR usado si el alta no lo
   * trae; si lo trae, se comprueba que esté libre ANTES del insert.
   */
  describe("el código", () => {
    it("sin código genera el siguiente de la serie por MAX, no por conteo", async () => {
      tx.$queryRaw.mockResolvedValue([{ max: 4 }]);
      await service.create(USER, { name: "Norte" }, META);
      expect(tx.supplier.create.mock.calls[0][0].data.code).toBe("PROV-005");
      // Sin código propio no hay nada que comprobar: `findFirst` no se toca.
      expect(tx.supplier.findFirst).not.toHaveBeenCalled();
    });

    it("con código propio lo comprueba libre y no consulta la serie", async () => {
      tx.supplier.findFirst.mockResolvedValue(null);
      await service.create(USER, { code: "ACME", name: "Acme" }, META);
      expect(tx.supplier.findFirst.mock.calls[0][0].where).toEqual({
        tenantId: TENANT,
        code: "ACME",
      });
      expect(tx.$queryRaw).not.toHaveBeenCalled();
      expect(tx.supplier.create.mock.calls[0][0].data.code).toBe("ACME");
    });

    it("un código ya usado es 409 suppliers.code_taken", async () => {
      await expect(
        service.create(USER, { code: "PROV-001", name: "Dup" }, META),
      ).rejects.toMatchObject({
        response: { message: "suppliers.code_taken" },
      });
      expect(tx.supplier.create).not.toHaveBeenCalled();
    });
  });

  describe("listar", () => {
    it("va alfabético con desempate por id, y solo del tenant", async () => {
      await service.list(USER, { page: 2, pageSize: 20 });
      const args = tx.supplier.findMany.mock.calls[0][0];
      expect(args.orderBy).toEqual([{ name: "asc" }, { id: "asc" }]);
      expect(args.where.tenantId).toBe(TENANT);
      expect(args.skip).toBe(20);
    });

    it("la búsqueda mira nombre, registro fiscal, contacto, teléfono y correo", async () => {
      await service.list(USER, { query: "norte", page: 1, pageSize: 20 });
      const where = tx.supplier.findMany.mock.calls[0][0].where;
      const campos = where.OR.map((c: Record<string, unknown>) => Object.keys(c)[0]);
      // F9-SUPPCAT-03: también por código.
      expect(campos.sort()).toEqual(["code", "contactName", "email", "name", "phone", "taxId"]);
      expect(where.OR[0].code.mode).toBe("insensitive");
    });

    it("`isActive` filtra; sin él salen activos e inactivos", async () => {
      await service.list(USER, { isActive: true, page: 1, pageSize: 20 });
      expect(tx.supplier.findMany.mock.calls[0][0].where.isActive).toBe(true);
      await service.list(USER, { page: 1, pageSize: 20 });
      expect(tx.supplier.findMany.mock.calls[1][0].where.isActive).toBeUndefined();
    });
  });

  describe("el registro fiscal", () => {
    it("en México se guarda normalizado y un RFC mal formado es 422", async () => {
      const creado = await service.create(USER, { name: "Norte", taxId: " dno900101ab1 " }, META);
      expect(creado.taxId).toBe("DNO900101AB1");
      await expect(service.create(USER, { name: "Norte", taxId: "NOPE" }, META)).rejects.toThrow(
        UnprocessableEntityException,
      );
      expect(tx.supplier.create).toHaveBeenCalledTimes(1);
    });

    it("sin país del negocio, todo vale (solo recorte y mayúsculas)", async () => {
      tx.tenant.findUniqueOrThrow.mockResolvedValue({ country: null });
      const creado = await service.create(USER, { name: "Norte", taxId: "abc-123" }, META);
      expect(creado.taxId).toBe("ABC-123");
    });

    it("vacío o null limpia el campo sin consultar el país", async () => {
      await service.update(USER, "s-1", { taxId: null }, META);
      expect(tx.supplier.update.mock.calls[0][0].data.taxId).toBeNull();
      expect(tx.tenant.findUniqueOrThrow).not.toHaveBeenCalled();
    });
  });

  describe("crear, editar, borrar", () => {
    it("crear audita en la misma tx con quién lo hizo", async () => {
      await service.create(USER, { name: "Norte" }, META);
      expect(tx.supplier.create.mock.calls[0][0].data.createdBy).toBe("u-1");
      expect(audit.record).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({ action: "supplier.created", resourceType: "supplier" }),
      );
    });

    it("editar manda solo lo que vino, fija `updated_by`, y el audit no lleva la relación", async () => {
      await service.update(USER, "s-1", { contactName: "Rosa" }, META);
      const data = tx.supplier.update.mock.calls[0][0].data;
      expect(data.contactName).toBe("Rosa");
      expect(data.name).toBeUndefined();
      expect(data.updater).toEqual({ connect: { id: "u-1" } });
      const after = audit.record.mock.calls[0][1].after;
      expect(after).toEqual({ contactName: "Rosa" });
    });

    it("get/update/remove de otro tenant es 404: el tenantId va en el WHERE", async () => {
      tx.supplier.findFirst.mockResolvedValue(null);
      await expect(service.get(USER, "ajeno")).rejects.toMatchObject({ status: 404 });
      expect(tx.supplier.findFirst.mock.calls[0][0].where).toEqual({
        id: "ajeno",
        tenantId: TENANT,
      });
    });

    it("borrar uno referenciado por una compra o un gasto es 409, no un 500", async () => {
      tx.supplier.delete.mockRejectedValue(p2003());
      await expect(service.remove(USER, "s-1", META)).rejects.toThrow(ConflictException);
      expect(audit.record).not.toHaveBeenCalled();
    });

    it("cualquier otro error del borrado sale crudo", async () => {
      tx.supplier.delete.mockRejectedValue(new Error("boom"));
      await expect(service.remove(USER, "s-1", META)).rejects.toThrow("boom");
    });
  });

  /**
   * Contactos de proveedor (Carlos, 2026-10-31). Lo que fija:
   *  - el contacto 1 sigue en las columnas del proveedor y gana `jobTitle`;
   *  - los adicionales viajan en `contacts`, en el orden del arreglo;
   *  - en la edición, `contacts` presente REEMPLAZA el conjunto y ausente no lo toca;
   *  - la dirección se valida contra el país del negocio, como en Sucursales,
   *    pero con las claves de proveedores;
   *  - la auditoría guarda los contactos.
   */
  describe("contactos adicionales y dirección", () => {
    const CONTACTOS = [
      { name: "Luis", phone: "+525511112222", email: "luis@norte.mx", jobTitle: "Compras" },
      { name: "Ana", phone: null, email: null, jobTitle: null },
    ];
    const INCLUDE = { contacts: { orderBy: { sortOrder: "asc" } } };

    it("el alta guarda la dirección, el puesto y los contactos en orden, y los devuelve", async () => {
      const creado = await service.create(
        USER,
        {
          name: "Norte",
          contactName: "Rosa",
          jobTitle: "Gerente",
          address: "Av. Juárez 10",
          addressLine2: "Col. Centro",
          city: "Guadalajara",
          region: "JAL",
          postalCode: " 44100 ",
          contacts: CONTACTOS,
        },
        META,
      );
      const args = tx.supplier.create.mock.calls[0][0];
      expect(args.include).toEqual(INCLUDE);
      expect(args.data).toMatchObject({
        jobTitle: "Gerente",
        addressLine2: "Col. Centro",
        city: "Guadalajara",
        region: "JAL",
        postalCode: "44100",
      });
      expect(args.data.contacts.create).toEqual([
        { tenantId: TENANT, sortOrder: 1, ...CONTACTOS[0] },
        { tenantId: TENANT, sortOrder: 2, ...CONTACTOS[1] },
      ]);
      expect(creado).toMatchObject({
        contactName: "Rosa",
        jobTitle: "Gerente",
        address: "Av. Juárez 10",
        addressLine2: "Col. Centro",
        city: "Guadalajara",
        region: "JAL",
        postalCode: "44100",
      });
      expect(creado.contacts).toEqual([
        { id: "c-1", ...CONTACTOS[0] },
        { id: "c-2", ...CONTACTOS[1] },
      ]);
      expect(audit.record.mock.calls[0][1].after).toEqual({
        code: "PROV-001",
        name: "Norte",
        taxId: null,
        contacts: CONTACTOS,
      });
    });

    it("un alta sin los campos nuevos no crea contactos ni consulta el país", async () => {
      const creado = await service.create(USER, { name: "Norte" }, META);
      const data = tx.supplier.create.mock.calls[0][0].data;
      expect(data.contacts).toBeUndefined();
      expect(data).toMatchObject({
        jobTitle: null,
        addressLine2: null,
        city: null,
        region: null,
        postalCode: null,
      });
      expect(tx.tenant.findUniqueOrThrow).not.toHaveBeenCalled();
      expect(creado).toMatchObject({
        jobTitle: null,
        addressLine2: null,
        city: null,
        region: null,
        postalCode: null,
        contacts: [],
      });
      expect(audit.record.mock.calls[0][1].after).toEqual({
        code: "PROV-001",
        name: "Norte",
        taxId: null,
        contacts: [],
      });
    });

    it("una región o un CP que no son del país del negocio son 422 con las claves de proveedores, como en Sucursales", async () => {
      const region = await service
        .create(USER, { name: "Norte", region: "ON" }, META)
        .catch((e: unknown) => e);
      expect(region).toBeInstanceOf(UnprocessableEntityException);
      expect((region as UnprocessableEntityException).getResponse()).toMatchObject({
        message: "suppliers.invalid_region",
      });
      await expect(service.update(USER, "s-1", { postalCode: "4410" }, META)).rejects.toMatchObject(
        {
          status: 422,
          response: { message: "suppliers.invalid_postal_code" },
        },
      );
      expect(tx.supplier.create).not.toHaveBeenCalled();
      expect(tx.supplier.update).not.toHaveBeenCalled();
    });

    it("leer y listar traen los contactos ordenados", async () => {
      tx.supplier.findFirst.mockResolvedValue(
        fila({ contacts: [contactoGuardado({ email: "pedro@norte.mx" })] }),
      );
      const leido = await service.get(USER, "s-1");
      expect(tx.supplier.findFirst.mock.calls[0][0].include).toEqual(INCLUDE);
      expect(leido.contacts).toEqual([
        { id: "c-viejo", name: "Pedro", phone: null, email: "pedro@norte.mx", jobTitle: null },
      ]);
      await service.list(USER, { page: 1, pageSize: 20 });
      expect(tx.supplier.findMany.mock.calls[0][0].include).toEqual(INCLUDE);
    });

    it("editar con `contacts` borra el conjunto anterior ANTES de crear el nuevo, en el orden del arreglo", async () => {
      tx.supplier.findFirst.mockResolvedValue(fila({ contacts: [contactoGuardado()] }));
      const editado = await service.update(
        USER,
        "s-1",
        { contacts: [...CONTACTOS].reverse() },
        META,
      );

      expect(tx.supplierContact.deleteMany).toHaveBeenCalledWith({
        where: { tenantId: TENANT, supplierId: "s-1" },
      });
      expect(tx.supplierContact.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(
        tx.supplier.update.mock.invocationCallOrder[0] as number,
      );
      const args = tx.supplier.update.mock.calls[0][0];
      expect(args.include).toEqual(INCLUDE);
      expect(args.data.contacts.create).toEqual([
        { tenantId: TENANT, sortOrder: 1, ...CONTACTOS[1] },
        { tenantId: TENANT, sortOrder: 2, ...CONTACTOS[0] },
      ]);
      expect(editado.contacts.map((c) => c.name)).toEqual(["Ana", "Luis"]);

      const registro = audit.record.mock.calls[0][1];
      expect(registro.before.contacts).toEqual([
        { name: "Pedro", phone: null, email: null, jobTitle: null },
      ]);
      expect(registro.after).toEqual({ contacts: [CONTACTOS[1], CONTACTOS[0]] });
    });

    it("editar con `contacts: []` o `null` deja al proveedor sin contactos adicionales", async () => {
      await service.update(USER, "s-1", { contacts: [] }, META);
      await service.update(USER, "s-1", { contacts: null }, META);
      expect(tx.supplierContact.deleteMany).toHaveBeenCalledTimes(2);
      expect(tx.supplier.update.mock.calls[0][0].data.contacts).toBeUndefined();
      expect(tx.supplier.update.mock.calls[1][0].data.contacts).toBeUndefined();
      expect(audit.record.mock.calls[1][1].after).toEqual({ contacts: [] });
    });

    it("editar SIN `contacts` no toca los contactos ni los pone en el audit", async () => {
      tx.supplier.findFirst.mockResolvedValue(fila({ contacts: [contactoGuardado()] }));
      const editado = await service.update(
        USER,
        "s-1",
        { jobTitle: "Directora", city: null },
        META,
      );
      expect(tx.supplierContact.deleteMany).not.toHaveBeenCalled();
      const data = tx.supplier.update.mock.calls[0][0].data;
      expect(data.contacts).toBeUndefined();
      expect(data).toMatchObject({ jobTitle: "Directora", city: null });
      const registro = audit.record.mock.calls[0][1];
      expect(registro.after).toEqual({ jobTitle: "Directora", city: null });
      expect(registro.before.contacts).toBeUndefined();
      expect(editado.jobTitle).toBe("Directora");
    });
  });
});
