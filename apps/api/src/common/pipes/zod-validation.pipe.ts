import { BadRequestException, type PipeTransform } from "@nestjs/common";
import type { ZodType } from "zod";
import type { $ZodIssue } from "zod/v4/core";

/**
 * Pipe genérico de validación con Zod (D2 del proposal: sin class-validator,
 * DTOs son schemas). Sigue el mismo contrato de error del resto del módulo
 * auth (f1-auth U1): `message` es la CLAVE i18n cruda, sin traducir acá
 * (mismo patrón que JwtAuthGuard — ver jwt-auth.guard.ts).
 *
 * Si el schema define un mensaje custom con forma de clave i18n (ej.
 * `z.string().min(12, "auth.weak_password")`) en el issue que falló, ese es
 * el `message` que viaja en la excepción — así AUTH-REQ-01 (password débil
 * → 400 auth.weak_password) sale del DTO sin lógica extra en el controller.
 * Cualquier otro issue (campo faltante, formato inválido) cae al `fallbackKey`.
 *
 * ── Errores POR CAMPO (2026-08-17) ──────────────────────────────────────
 * Además del `message` general, el 400 lleva `errors: [{ key, message, args }]`
 * con una entrada por campo malo. El disparador: escribir `1000` en un campo de
 * merma que admite hasta 100 devolvía `products.invalid_body` a secas —ni qué
 * campo, ni por qué—. `key` es la RUTA completa (`lines.0.wastePercentage`)
 * para que el formulario sepa qué fila pintar, y `args` lleva el límite para
 * que el texto traducido pueda decirlo ("Debe ser 100 o menos").
 */
export class ZodValidationPipe implements PipeTransform {
  constructor(
    private readonly schema: ZodType,
    private readonly fallbackKey: string,
  ) {}

  transform(value: unknown): unknown {
    const result = this.schema.safeParse(value);

    if (!result.success) {
      const firstMessage = result.error.issues[0]?.message;
      const messageKey = firstMessage?.includes(".") ? firstMessage : this.fallbackKey;
      throw new BadRequestException({
        message: messageKey,
        errors: result.error.issues.map(toFieldError),
      });
    }

    return result.data;
  }
}

export interface ValidationFieldError {
  /** Ruta del campo dentro del body: `lines.0.wastePercentage`. */
  key: string;
  /** Clave i18n — la traduce el filtro de excepciones, con `args`. */
  message: string;
  /** Valores a interpolar en el texto (límites, formatos). */
  args?: Record<string, unknown>;
}

/**
 * Traduce un issue de Zod a la clave que le habla a una PERSONA.
 *
 * Los códigos de Zod razonan sobre el dato (`too_big`, `invalid_type`); las
 * claves de acá razonan sobre lo que el usuario hizo mal. Por eso `too_big` se
 * abre en cuatro según el `origin` y el `inclusive`: "máximo 500 caracteres" y
 * "debe ser 100 o menos" son la misma condición para Zod y dos frases distintas
 * para quien está llenando el formulario.
 */
function toFieldError(issue: $ZodIssue): ValidationFieldError {
  const key = issue.path.map(String).join(".");

  // Un mensaje custom con forma de clave i18n ya es la respuesta final: el
  // schema decidió qué decir (ej. `auth.weak_password`).
  if (issue.message.includes(".") && /^[a-z_]+\.[a-z_.]+$/.test(issue.message)) {
    return { key, message: issue.message };
  }

  switch (issue.code) {
    case "invalid_type":
      // Zod no distingue "falta" de "vino con otro tipo" (no expone el input),
      // y da igual: para el usuario ambas cosas se arreglan escribiendo el dato
      // bien. Hablarle de `number` no lo ayudaría.
      return { key, message: "validation.required" };

    case "too_big": {
      const max = issue.maximum as number;
      if (issue.origin === "string") {
        return { key, message: "validation.max_length", args: { max } };
      }
      if (issue.origin === "array") {
        return { key, message: "validation.max_items", args: { max } };
      }
      return {
        key,
        message: issue.inclusive ? "validation.max" : "validation.less_than",
        args: { max },
      };
    }

    case "too_small": {
      const min = issue.minimum as number;
      if (issue.origin === "string") {
        return { key, message: "validation.min_length", args: { min } };
      }
      if (issue.origin === "array") {
        return { key, message: "validation.min_items", args: { min } };
      }
      return {
        key,
        message: issue.inclusive ? "validation.min" : "validation.greater_than",
        args: { min },
      };
    }

    case "invalid_format":
      return { key, message: "validation.invalid_format" };

    case "unrecognized_keys":
      return { key, message: "validation.unknown_field" };

    default:
      return { key, message: "validation.invalid_value" };
  }
}
