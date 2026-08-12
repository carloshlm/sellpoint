import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PERMISSIONS_KEY } from "../decorators/require-permissions.decorator";
import type { AuthUser } from "../types/auth-user";

type AuthenticatedRequest = { user?: AuthUser };

/**
 * F1-RBAC-01: autorización por permisos. Registrado como APP_GUARD global
 * DESPUÉS del `JwtAuthGuard` — Nest los corre en orden de registro, así que
 * acá `request.user` ya viene de un token con firma y epoch validados.
 *
 * Sin metadata de `@RequirePermissions` el handler pasa: estar autenticado
 * es suficiente. La ausencia de `request.user`, en cambio, NUNCA pasa
 * cuando hay permisos exigidos — si el JwtAuthGuard no corrió (orden mal
 * registrado, `@Public()` sobre un endpoint que exige permisos), fallamos
 * cerrado en vez de autorizar a un anónimo.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[] | undefined>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required || required.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const granted = request.user?.permissions ?? [];

    // AND: todos los requeridos. Un JWT con permissions:[] (tenant cuyo
    // catálogo no se sembró) no pasa ningún endpoint protegido.
    if (!required.every((permission) => granted.includes(permission))) {
      throw new ForbiddenException({ message: "auth.forbidden" });
    }

    return true;
  }
}
