import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
} from "./schemas";

describe("auth schemas", () => {
  describe("loginSchema", () => {
    it("acepta email + password válidos", () => {
      const result = loginSchema.safeParse({ email: "ana@acme.mx", password: "x" });
      expect(result.success).toBe(true);
    });

    it("rechaza email inválido con clave i18n", () => {
      const result = loginSchema.safeParse({ email: "no-es-email", password: "x" });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message).toBe("validation.email");
    });

    it("rechaza password vacío con clave i18n", () => {
      const result = loginSchema.safeParse({ email: "ana@acme.mx", password: "" });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message).toBe("validation.required");
    });
  });

  describe("registerSchema (NIST: 12+ sin composición)", () => {
    // Sin `tenantName` (Carlos, 2026-08-25): el negocio se nombra en el
    // paso 1 del wizard, no en el registro.
    const base = {
      firstName: "Ana",
      lastNamePaternal: "García",
      lastNameMaternal: "",
      email: "ana@acme.mx",
      password: "solo minusculas larga",
    };

    it("acepta password de 12+ sin mayúsculas ni números", () => {
      expect(registerSchema.safeParse(base).success).toBe(true);
    });

    it("rechaza password de menos de 12 caracteres", () => {
      const result = registerSchema.safeParse({ ...base, password: "corta123456" });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message).toBe("validation.passwordMin");
    });

    it("lastNameMaternal vacío se normaliza a undefined", () => {
      const result = registerSchema.safeParse(base);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.lastNameMaternal).toBeUndefined();
      }
    });

    it("campos obligatorios vacíos reportan validation.required", () => {
      const result = registerSchema.safeParse({ ...base, firstName: "  " });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message).toBe("validation.required");
    });
  });

  describe("forgotPasswordSchema", () => {
    it("solo pide un email válido", () => {
      expect(forgotPasswordSchema.safeParse({ email: "ana@acme.mx" }).success).toBe(true);
      expect(forgotPasswordSchema.safeParse({ email: "nope" }).success).toBe(false);
    });
  });

  describe("resetPasswordSchema", () => {
    it("aplica la misma política de 12+ del registro", () => {
      expect(resetPasswordSchema.safeParse({ password: "doce doce doce" }).success).toBe(true);
      const short = resetPasswordSchema.safeParse({ password: "once once o" });
      expect(short.success).toBe(false);
      expect(short.error?.issues[0]?.message).toBe("validation.passwordMin");
    });
  });

  describe("changePasswordSchema (F1-WEB-AUTH-10)", () => {
    const valid = {
      currentPassword: "la de siempre",
      newPassword: "doce doce doce",
      confirmPassword: "doce doce doce",
    };

    it("acepta actual + nueva de 12+ con confirmación coincidente", () => {
      expect(changePasswordSchema.safeParse(valid).success).toBe(true);
    });

    it("la password actual solo se exige no vacía (una vieja corta debe poder mandarse y fallar en el backend)", () => {
      expect(changePasswordSchema.safeParse({ ...valid, currentPassword: "abc" }).success).toBe(
        true,
      );
      const empty = changePasswordSchema.safeParse({ ...valid, currentPassword: "" });
      expect(empty.success).toBe(false);
      expect(empty.error?.issues[0]?.message).toBe("validation.required");
    });

    it("la password nueva aplica la MISMA política de 12+ que registro y reset", () => {
      const short = changePasswordSchema.safeParse({
        ...valid,
        newPassword: "once once o",
        confirmPassword: "once once o",
      });
      expect(short.success).toBe(false);
      expect(short.error?.issues[0]?.message).toBe("validation.passwordMin");
    });

    it("confirmación distinta → error apuntando al campo de confirmación", () => {
      const result = changePasswordSchema.safeParse({
        ...valid,
        confirmPassword: "otra cosa larga",
      });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message).toBe("validation.passwordMismatch");
      expect(result.error?.issues[0]?.path).toEqual(["confirmPassword"]);
    });
  });
});
