import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import { Request } from "express";
import { AuthUser } from "../types/auth-user";

/**
 * Lee `req.user`, adjuntado por `JwtAuthGuard`. Solo tiene sentido en rutas
 * protegidas (sin `@Public()`) — en rutas públicas el guard nunca corre y
 * `req.user` queda `undefined`.
 */
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  const request = ctx.switchToHttp().getRequest<Request & { user: AuthUser }>();
  return request.user;
});
