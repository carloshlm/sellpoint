import { SetMetadata } from "@nestjs/common";

export const IS_PUBLIC_KEY = "isPublic";

/**
 * Marca un handler/controller como exento del `JwtAuthGuard` global
 * (f1-auth AD-8: secure by default, `@Public()` es la excepción explícita).
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
