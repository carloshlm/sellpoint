import { BadRequestException } from "@nestjs/common";
import { z } from "zod";
import { ZodValidationPipe } from "./zod-validation.pipe";

describe("ZodValidationPipe", () => {
  const schema = z.object({
    email: z.string().email(),
    password: z.string().min(12, "auth.weak_password"),
  });

  it("body válido pasa y devuelve el value parseado", () => {
    const pipe = new ZodValidationPipe(schema, "auth.invalid_body");

    const result = pipe.transform({ email: "a@example.com", password: "twelve-chars" });

    expect(result).toEqual({ email: "a@example.com", password: "twelve-chars" });
  });

  it("password corto → BadRequestException con message=auth.weak_password (AUTH-REQ-01)", () => {
    const pipe = new ZodValidationPipe(schema, "auth.invalid_body");

    try {
      pipe.transform({ email: "a@example.com", password: "corta" });
      throw new Error("no debería llegar acá");
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toEqual({
        message: "auth.weak_password",
      });
    }
  });

  it("otro campo inválido sin mensaje custom → cae al fallbackKey genérico", () => {
    const pipe = new ZodValidationPipe(schema, "auth.invalid_body");

    try {
      pipe.transform({ email: "no-es-un-email", password: "twelve-chars" });
      throw new Error("no debería llegar acá");
    } catch (error) {
      expect((error as BadRequestException).getResponse()).toEqual({
        message: "auth.invalid_body",
      });
    }
  });
});
