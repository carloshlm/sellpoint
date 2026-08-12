import { BadRequestException, ConflictException, Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Env } from "../../config/env.schema";
import { Prisma } from "../../generated/prisma/client";
import { CLOCK, type ClockPort } from "../../infrastructure/clock/clock.port";
import { HASHER, type HashPort } from "../../infrastructure/crypto/hash.port";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { MAILER, type MailerPort } from "../mail/mailer.port";
import { TenantsService } from "../tenants/tenants.service";
import { AuthRepository } from "./repositories/auth.repository";
import { OneTimeTokenService } from "./services/one-time-token.service";

const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

export interface RegisterTenantInput {
  tenantName: string;
  currency?: string;
  email: string;
  password: string;
  firstName: string;
  lastNamePaternal: string;
  lastNameMaternal?: string;
  locale?: "es" | "en";
}

export interface RequestMeta {
  ip?: string;
  userAgent?: string;
}

/**
 * f1-auth design §4 (register-tenant + verify-email). CERO SQL directo acá
 * — todo pasa por AuthRepository/TenantsService. Molde de referencia del
 * módulo auth (IMPLEMENTACION.md:636).
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly appUrl: string;

  constructor(
    private readonly tenantsService: TenantsService,
    @Inject(HASHER) private readonly hasher: HashPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    private readonly oneTimeTokenService: OneTimeTokenService,
    private readonly authRepository: AuthRepository,
    @Inject(MAILER) private readonly mailer: MailerPort,
    private readonly auditService: AuditService,
    private readonly prisma: PrismaService,
    configService: ConfigService<Env, true>,
  ) {
    this.appUrl = configService.get("APP_URL", { infer: true });
  }

  async registerTenant(
    input: RegisterTenantInput,
    meta: RequestMeta,
  ): Promise<{ tenantId: string; userId: string }> {
    // AD-1: argon2 (~80-150ms) SIEMPRE fuera de cualquier $transaction —
    // retenerlo adentro agota el pool de conexiones bajo concurrencia.
    const passwordHash = await this.hasher.hash(input.password);

    let result: { tenantId: string; userId: string };
    try {
      result = await this.tenantsService.provision({
        tenantName: input.tenantName,
        currency: input.currency,
        ownerEmail: input.email,
        ownerPasswordHash: passwordHash,
        firstName: input.firstName,
        lastNamePaternal: input.lastNamePaternal,
        lastNameMaternal: input.lastNameMaternal,
        locale: input.locale,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        // R4 del design: enumeración de emails aceptada conscientemente en
        // signup — decirle "listo" a alguien con cuenta ya existente
        // destruye el onboarding B2B. Mitigado por throttle auth-ip (U6).
        throw new ConflictException({ message: "auth.email_taken" });
      }
      throw error;
    }

    const { token, tokenHash } = this.oneTimeTokenService.generate();
    const expiresAt = new Date(this.clock.now().getTime() + EMAIL_VERIFICATION_TTL_MS);

    // Tras el commit de provision() (design §4) — tokens no tienen RLS, el
    // cliente base alcanza.
    await this.authRepository.createEmailVerificationToken({
      tenantId: result.tenantId,
      userId: result.userId,
      tokenHash,
      expiresAt,
    });

    const link = `${this.appUrl}/verify-email?token=${token}`;

    // Fire-and-forget: un fallo del proveedor de mail JAMÁS rompe el
    // request (AD-9) — el dominio de MAIL_FROM todavía no tiene SPF/DKIM
    // verificados en Resend.
    this.mailer
      .send({
        to: input.email,
        template: "verify-email",
        vars: { firstName: input.firstName, link },
        locale: input.locale ?? "es",
      })
      .catch((error: unknown) => {
        this.logger.error(
          `Fallo al enviar mail de verificación a ${input.email}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });

    return result;
  }

  async verifyEmail(token: string, meta: RequestMeta): Promise<void> {
    const tokenHash = this.oneTimeTokenService.hash(token);
    const row = await this.authRepository.findEmailVerificationTokenByHash(tokenHash);
    const now = this.clock.now();

    // Misma clave para inexistente/usado/expirado (design §4): no le decimos
    // al atacante en cuál de los tres se equivocó.
    if (!row || row.usedAt !== null || row.expiresAt < now) {
      throw new BadRequestException({ message: "auth.token_invalid" });
    }

    await this.prisma.withTenantContext(row.tenantId, async (tx) => {
      await this.authRepository.activateUser(tx, row.userId, now);
      await this.authRepository.markEmailVerificationTokenUsed(tx, row.id, now);
      await this.auditService.record(tx, {
        tenantId: row.tenantId,
        userId: row.userId,
        action: "auth.email.verified",
        resourceType: "user",
        resourceId: row.userId,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
    });
  }
}
