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

  /** Devuelve el body del 400 sin repetir el try/catch en cada caso. */
  function reject(value: unknown, fallback = "auth.invalid_body"): Record<string, unknown> {
    try {
      new ZodValidationPipe(schema, fallback).transform(value);
      throw new Error("no debería llegar acá");
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      return (error as BadRequestException).getResponse() as Record<string, unknown>;
    }
  }

  it("password corto → BadRequestException con message=auth.weak_password (AUTH-REQ-01)", () => {
    expect(reject({ email: "a@example.com", password: "corta" })).toMatchObject({
      message: "auth.weak_password",
    });
  });

  it("otro campo inválido sin mensaje custom → cae al fallbackKey genérico", () => {
    expect(reject({ email: "no-es-un-email", password: "twelve-chars" })).toMatchObject({
      message: "auth.invalid_body",
    });
  });

  /**
   * "Los datos no son válidos" no le sirve a nadie: Carlos escribió 1000 en un
   * campo de merma que admite hasta 100 y el formulario le dijo
   * `products.invalid_body`, sin decir qué campo ni por qué. El pipe ahora
   * reporta POR CAMPO, con la clave i18n y los datos para interpolar.
   */
  describe("errores por campo", () => {
    const composition = z.object({
      lines: z.array(
        z.object({
          quantity: z.number().positive(),
          wastePercentage: z.number().min(0).max(100),
          notes: z.string().max(500).optional(),
        }),
      ),
    });

    function rejectComposition(value: unknown) {
      try {
        new ZodValidationPipe(composition, "products.invalid_body").transform(value);
        throw new Error("no debería llegar acá");
      } catch (error) {
        return (error as BadRequestException).getResponse() as {
          errors: { key: string; message: string; args?: Record<string, unknown> }[];
        };
      }
    }

    it("señala el campo exacto dentro del arreglo y con cuánto se pasó", () => {
      const body = rejectComposition({
        lines: [{ quantity: 1, wastePercentage: 1000 }],
      });

      expect(body.errors).toEqual([
        {
          // La ruta completa: el formulario sabe qué fila pintar.
          key: "lines.0.wastePercentage",
          message: "validation.max",
          args: { max: 100 },
        },
      ]);
    });

    it("distingue el límite INCLUSIVO del exclusivo: `positive()` no es `min(0)`", () => {
      const body = rejectComposition({ lines: [{ quantity: 0, wastePercentage: 0 }] });

      expect(body.errors[0]).toEqual({
        key: "lines.0.quantity",
        message: "validation.greater_than",
        args: { min: 0 },
      });
    });

    it("un texto largo habla de CARACTERES, no de un número máximo", () => {
      const body = rejectComposition({
        lines: [{ quantity: 1, wastePercentage: 0, notes: "x".repeat(501) }],
      });

      expect(body.errors[0]).toMatchObject({
        key: "lines.0.notes",
        message: "validation.max_length",
        args: { max: 500 },
      });
    });

    it("un dato que falta no habla de tipos: el usuario no sabe qué es un `number`", () => {
      const body = rejectComposition({ lines: [{ wastePercentage: 0 }] });

      expect(body.errors[0]).toEqual({
        key: "lines.0.quantity",
        message: "validation.required",
      });
    });

    it("reporta TODOS los campos malos juntos, no el primero", () => {
      const body = rejectComposition({
        lines: [{ quantity: -1, wastePercentage: 200 }],
      });

      expect(body.errors.map((item) => item.key)).toEqual([
        "lines.0.quantity",
        "lines.0.wastePercentage",
      ]);
    });
  });
});
