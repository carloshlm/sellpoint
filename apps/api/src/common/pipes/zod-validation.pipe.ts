import { BadRequestException, type PipeTransform } from "@nestjs/common";
import type { ZodType } from "zod";

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
      throw new BadRequestException({ message: messageKey });
    }

    return result.data;
  }
}
