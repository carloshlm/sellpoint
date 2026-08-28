import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Env } from "../../../config/env.schema";
import { PrismaService } from "../../../infrastructure/prisma/prisma.service";
import type { AuthUser } from "../../auth/types/auth-user";

type AuthenticatedRequest = { user?: AuthUser };

/**
 * F7-ADMIN-01 — la puerta del backoffice de la plataforma: CUATRO llaves en
 * AND. No existe SuperAdmin (los roles son POR tenant), así que el plano de
 * administración del dueño se gatea con:
 *
 *   users.is_platform_admin  Y  email ∈ BILLING_ADMIN_EMAILS (env)
 *   Y  status = active       Y  email verificado
 *
 * Dos llaves de fondo para que ninguna falla baste sola: un UPDATE malicioso
 * al flag no sirve sin la whitelist del env, y un email reasignado en la
 * whitelist no sirve sin el flag. El flag NO viaja en el JWT a propósito: un
 * token de 15 minutos conservaría el privilegio tras revocarlo — se consulta
 * por PK en cada request, y solo /admin/* paga esa query.
 */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService<Env, true>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user;
    if (!user) {
      throw new ForbiddenException({ message: "billing.not_platform_admin" });
    }

    const whitelist = (this.configService.get("BILLING_ADMIN_EMAILS", { infer: true }) ?? "")
      .split(",")
      .map((email: string) => email.trim().toLowerCase())
      .filter((email: string) => email.length > 0);

    const fila = await this.prisma.withTenantContext(user.tenantId, (tx) =>
      tx.user.findUnique({
        where: { id: user.userId },
        select: { isPlatformAdmin: true, email: true, status: true, emailVerifiedAt: true },
      }),
    );

    const autorizado =
      fila !== null &&
      fila.isPlatformAdmin &&
      whitelist.includes(fila.email.toLowerCase()) &&
      fila.status === "active" &&
      fila.emailVerifiedAt !== null;

    if (!autorizado) {
      throw new ForbiddenException({ message: "billing.not_platform_admin" });
    }

    return true;
  }
}
