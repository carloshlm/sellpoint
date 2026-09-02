import { createTurnSchema, listTurnsQuerySchema } from "./dto/turns.dto";
import {
  createCustomerSchema,
  listCustomersQuerySchema,
  updateCustomerSchema,
} from "./dto/upsert-customer.dto";

/**
 * F9-RECEP-05 — los cuerpos de Recepción. El teléfono es E.164 (misma regla
 * que `tenants.phone`), nadie nace mañana, y un update vacío no es un update.
 */
describe("DTOs de Recepción (F9-RECEP-05)", () => {
  const minimo = { firstName: "Ana", lastNamePaternal: "Pérez" };

  it("un cliente nace con nombres y apellido paterno; lo demás es opcional", () => {
    const parsed = createCustomerSchema.parse(minimo);
    expect(parsed.firstName).toBe("Ana");
    expect(parsed.birthDate).toBeUndefined();
  });

  it("el teléfono es E.164: sin el prefijo internacional rebota con su clave", () => {
    const res = createCustomerSchema.safeParse({ ...minimo, phone: "5512345678" });
    expect(res.success).toBe(false);
    expect(JSON.stringify(res.error?.issues)).toContain("reception.invalid_phone");
    expect(createCustomerSchema.parse({ ...minimo, phone: "+525512345678" }).phone).toBe(
      "+525512345678",
    );
  });

  it("nadie nace mañana", () => {
    const res = createCustomerSchema.safeParse({ ...minimo, birthDate: "2099-01-01" });
    expect(res.success).toBe(false);
    expect(JSON.stringify(res.error?.issues)).toContain("reception.invalid_birth_date");
    expect(createCustomerSchema.parse({ ...minimo, birthDate: "1990-09-02" }).birthDate).toBe(
      "1990-09-02",
    );
    expect(createCustomerSchema.safeParse({ ...minimo, birthDate: "ayer" }).success).toBe(false);
  });

  it("el correo, si viene, tiene que ser un correo", () => {
    expect(createCustomerSchema.safeParse({ ...minimo, email: "nope" }).success).toBe(false);
    expect(createCustomerSchema.parse({ ...minimo, email: "ana@acme.mx" }).email).toBe(
      "ana@acme.mx",
    );
  });

  it("un update vacío rebota con reception.empty_update", () => {
    const res = updateCustomerSchema.safeParse({});
    expect(res.success).toBe(false);
    expect(JSON.stringify(res.error?.issues)).toContain("reception.empty_update");
    expect(updateCustomerSchema.parse({ notes: null }).notes).toBeNull();
  });

  it("la lista pagina con default 20 y tope 100", () => {
    expect(listCustomersQuerySchema.parse({})).toEqual({ page: 1, pageSize: 20 });
    expect(listCustomersQuerySchema.safeParse({ pageSize: 500 }).success).toBe(false);
    expect(listCustomersQuerySchema.parse({ query: "  ana  " }).query).toBe("ana");
  });

  it("un turno se genera sin cliente o con un uuid de cliente", () => {
    expect(createTurnSchema.parse({})).toEqual({});
    expect(createTurnSchema.safeParse({ customerId: "x" }).success).toBe(false);
  });

  it("el filtro de fecha de los turnos es un día del calendario", () => {
    expect(listTurnsQuerySchema.parse({ date: "2026-09-02" }).date).toBe("2026-09-02");
    expect(listTurnsQuerySchema.safeParse({ date: "hoy" }).success).toBe(false);
    expect(listTurnsQuerySchema.parse({}).date).toBeUndefined();
  });
});
