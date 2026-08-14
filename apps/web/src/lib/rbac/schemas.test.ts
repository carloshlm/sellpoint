import { roleFormSchema, userFormSchema } from "./schemas";

describe("rbac schemas", () => {
  describe("userFormSchema (espejo de create-user.dto.ts)", () => {
    const base = {
      email: "ana@acme.mx",
      firstName: "Ana",
      lastNamePaternal: "García",
      roleIds: ["11111111-1111-1111-1111-111111111111"],
    };

    it("acepta el mínimo requerido: email + nombre + al menos un rol", () => {
      expect(userFormSchema.safeParse(base).success).toBe(true);
    });

    it("rechaza email inválido con clave i18n", () => {
      const result = userFormSchema.safeParse({ ...base, email: "no-es-email" });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message).toBe("validation.email");
    });

    it("rechaza firstName vacío con clave i18n", () => {
      const result = userFormSchema.safeParse({ ...base, firstName: "  " });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message).toBe("validation.required");
    });

    it("sin ningún rol seleccionado reporta validation.rolesRequired", () => {
      const result = userFormSchema.safeParse({ ...base, roleIds: [] });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message).toBe("validation.rolesRequired");
    });

    it("lastNameMaternal vacío se normaliza a undefined (igual que en auth/register)", () => {
      const result = userFormSchema.safeParse({ ...base, lastNameMaternal: "" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.lastNameMaternal).toBeUndefined();
      }
    });
  });

  describe("roleFormSchema (espejo de create-role.dto.ts)", () => {
    it("acepta un nombre no vacío sin permisos (rol recién creado)", () => {
      const result = roleFormSchema.safeParse({ name: "Cajero", permissionCodes: [] });
      expect(result.success).toBe(true);
    });

    it("rechaza name vacío con clave i18n", () => {
      const result = roleFormSchema.safeParse({ name: "  ", permissionCodes: [] });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message).toBe("validation.required");
    });

    it("permissionCodes por default es []", () => {
      const result = roleFormSchema.safeParse({ name: "Cajero" });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.permissionCodes).toEqual([]);
      }
    });
  });
});
