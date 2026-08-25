import { randomUUID } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  type OnModuleInit,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Redis } from "ioredis";
import type { Env } from "../../config/env.schema";
import { Prisma } from "../../generated/prisma/client";
import { CLOCK, type ClockPort } from "../../infrastructure/clock/clock.port";
import { HASHER, type HashPort } from "../../infrastructure/crypto/hash.port";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import { REDIS_CLIENT } from "../../infrastructure/redis/redis.module";
import { AuditService } from "../audit/audit.service";
import { MAILER, type MailerPort } from "../mail/mailer.port";
import { TENANT_SELECT, type TenantBlock, toTenantBlock } from "../tenants/tenant.types";
import { TenantsService } from "../tenants/tenants.service";
import {
  authEmailThrottleKey,
  authIpThrottleKey,
  normalizeThrottleEmail,
} from "./auth-throttle.keys";
import { passwordSchema } from "./dto/register-tenant.dto";
import { AuthRepository } from "./repositories/auth.repository";
import { OneTimeTokenService } from "./services/one-time-token.service";
import { RefreshTokenService } from "./services/refresh-token.service";
import { groupSessionsByFamily, type SessionSummary } from "./services/session-list";
import { TokenService } from "./services/token.service";
import type { AuthUser } from "./types/auth-user";

const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
// AUTH-REQ-08: TTL fijo de 30 min (spec) — no es configurable por env, igual
// que EMAIL_VERIFICATION_TTL_MS arriba.
const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;
// AUTH-REQ-03: password nunca usado para autenticar de verdad — solo existe
// para que argon2.verify() consuma el MISMO tiempo de CPU cuando el email
// no existe (anti-timing). No es un secreto: si se filtra, no habilita nada.
const DUMMY_PASSWORD_FOR_TIMING = "dummy-password-constant-time-verify";

export interface RegisterTenantInput {
  tenantName?: string;
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
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);
  private readonly appUrl: string;
  private readonly accessTtlSeconds: number;
  // AUTH-REQ-03: precomputado UNA vez al bootear (OnModuleInit, equivalente
  // async del "constructor" del design) — nunca recalculado por request, así
  // el timing es constante desde el primer login.
  private dummyHash!: string;

  constructor(
    private readonly tenantsService: TenantsService,
    @Inject(HASHER) private readonly hasher: HashPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    private readonly oneTimeTokenService: OneTimeTokenService,
    private readonly authRepository: AuthRepository,
    @Inject(MAILER) private readonly mailer: MailerPort,
    private readonly auditService: AuditService,
    private readonly prisma: PrismaService,
    private readonly tokenService: TokenService,
    private readonly refreshTokenService: RefreshTokenService,
    configService: ConfigService<Env, true>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    this.appUrl = configService.get("APP_URL", { infer: true });
    this.accessTtlSeconds = configService.get("JWT_ACCESS_TTL_MIN", { infer: true }) * 60;
  }

  async onModuleInit(): Promise<void> {
    this.dummyHash = await this.hasher.hash(DUMMY_PASSWORD_FOR_TIMING);
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

    // D3 (#347): el token viaja por fragmento, no por query string, para que
    // JAMÁS aparezca en un access log de servidor (el fragmento no viaja al
    // servidor). Ver apps/web/src/lib/auth/token-from-url.ts.
    const link = `${this.appUrl}/verify-email#token=${token}`;

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

  /**
   * AUTH-REQ-03 (design §4): a prueba de enumeración — el mismo
   * `401 auth.invalid_credentials` sale de CUALQUIERA de: email inexistente,
   * password incorrecto, usuario invitado sin password. `argon2.verify`
   * corre SIEMPRE, incluso cuando ya sabemos que va a fallar, para que el
   * tiempo de CPU no delate cuál de los casos fue.
   */
  async login(input: LoginInput, meta: RequestMeta): Promise<LoginResult> {
    const tenantId = await this.authRepository.resolveTenantByEmail(input.email);

    if (!tenantId) {
      await this.hasher.verify(this.dummyHash, input.password);
      // AD-10: sin tenant no hay dónde auditar en DB (audit_logs exige
      // tenant_id NOT NULL) — esto va solo al log estructurado de pino.
      this.logger.warn("login fallido: email no registrado en ningún tenant");
      throw new UnauthorizedException({ message: "auth.invalid_credentials" });
    }

    // AD-1: lectura CORTA, cierra antes de verificar el hash.
    const user = await this.prisma.withTenantContext(tenantId, (tx) =>
      this.authRepository.findUserByTenantAndEmail(tx, tenantId, input.email),
    );

    if (!user || user.passwordHash === null) {
      await this.hasher.verify(this.dummyHash, input.password);
      throw new UnauthorizedException({ message: "auth.invalid_credentials" });
    }

    // argon2 SIEMPRE fuera de la tx (AD-1: ~80-150ms retendría una
    // conexión del pool).
    const passwordValid = await this.hasher.verify(user.passwordHash, input.password);

    if (!passwordValid) {
      await this.prisma.withTenantContext(tenantId, (tx) =>
        this.auditService.record(tx, {
          tenantId,
          userId: user.id,
          action: "auth.login.failed",
          resourceType: "user",
          resourceId: user.id,
          ip: meta.ip,
          userAgent: meta.userAgent,
        }),
      );
      throw new UnauthorizedException({ message: "auth.invalid_credentials" });
    }

    if (user.status === "suspended") {
      throw new ForbiddenException({ message: "auth.account_suspended" });
    }

    if (user.emailVerifiedAt === null) {
      throw new ForbiddenException({ message: "auth.email_not_verified" });
    }

    const familyId = randomUUID();

    // W2 del verify de f1-auth, cobrado en producción (2026-08-14): el
    // throttle contaba TODOS los intentos, también los EXITOSOS. Un usuario
    // que acierta su password gastaba presupuesto anti-fuerza-bruta, así que
    // 5 logins legítimos en 15 min lo dejaban afuera — y a toda su oficina
    // detrás del mismo NAT. Acertar la password DEMUESTRA que no sos un
    // atacante adivinando: se liberan los dos contadores. Los intentos
    // FALLIDOS siguen acumulando, que es lo único que el límite debe frenar.
    await this.clearAuthThrottle(meta.ip, input.email);

    return this.prisma.withTenantContext(tenantId, async (tx) => {
      const permissions = await this.authRepository.resolvePermissionCodes(tx, user.id);
      const tenantRow = await tx.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        select: TENANT_SELECT,
      });
      const { token: rawRefreshToken, tokenHash } = this.oneTimeTokenService.generate();
      const refreshExpiresAt = this.refreshTokenService.buildExpiry();

      await this.authRepository.createRefreshToken(tx, {
        tenantId,
        userId: user.id,
        tokenHash,
        familyId,
        expiresAt: refreshExpiresAt,
      });

      await this.auditService.record(tx, {
        tenantId,
        userId: user.id,
        action: "auth.login.success",
        resourceType: "user",
        resourceId: user.id,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      const locale = user.locale as "es" | "en";
      const accessToken = this.tokenService.signAccessToken({
        sub: user.id,
        tenantId,
        permissions,
        locale,
      });

      return {
        accessToken,
        expiresIn: this.accessTtlSeconds,
        refreshToken: rawRefreshToken,
        refreshExpiresAt,
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          locale,
          permissions,
          tenant: toTenantBlock(tenantRow),
        },
      };
    });
  }

  /**
   * AUTH-REQ-05/06/11 (design §4). `rawToken` viene de la cookie
   * `sp_refresh` — el controller es responsable de limpiarla en CUALQUIER
   * error (catch genérico), acá solo se orquesta la lógica de dominio.
   */
  async refresh(rawToken: string | undefined, meta: RequestMeta): Promise<RefreshResult> {
    if (!rawToken) {
      throw new UnauthorizedException({ message: "auth.missing_refresh_token" });
    }

    const tokenHash = this.oneTimeTokenService.hash(rawToken);
    const row = await this.authRepository.findRefreshTokenByHash(tokenHash);

    if (!row) {
      throw new UnauthorizedException({ message: "auth.invalid_refresh_token" });
    }

    // AUTH-REQ-06: reuso de un token ya rotado/revocado — robo probable.
    // Revocar la familia entera necesita auditar (audit_logs tiene RLS), por
    // eso SÍ abre contexto acá aunque refresh_tokens no tenga RLS (AD-3).
    if (row.usedAt !== null || row.revokedAt !== null) {
      await this.prisma.withTenantContext(row.tenantId, async (tx) => {
        await this.refreshTokenService.revokeFamily(tx, row.familyId);
        await this.auditService.record(tx, {
          tenantId: row.tenantId,
          userId: row.userId,
          action: "auth.refresh.reuse_detected",
          resourceType: "refresh_token_family",
          resourceId: row.familyId,
          ip: meta.ip,
          userAgent: meta.userAgent,
        });
      });
      throw new UnauthorizedException({ message: "auth.token_reused" });
    }

    if (row.expiresAt < this.clock.now()) {
      throw new UnauthorizedException({ message: "auth.invalid_refresh_token" });
    }

    const oldestCreatedAt = await this.authRepository.findOldestFamilyCreatedAt(row.familyId);
    if (oldestCreatedAt && this.refreshTokenService.isFamilyOverCap(oldestCreatedAt)) {
      throw new UnauthorizedException({ message: "auth.invalid_refresh_token" });
    }

    // C1 (verify #271): el `withTenantContext` de acá abajo es un
    // `$transaction` de Prisma (AD-1) — un `throw` DENTRO del callback hace
    // ROLLBACK de TODO lo escrito en esa transacción, incluida la
    // revocación de familia y el audit que las ramas `!rotated`/suspendido
    // acaban de grabar. Por eso el callback NUNCA throwea: siempre devuelve
    // un `RefreshOutcome` y el `$transaction` comitea sin importar la rama.
    // Recién DESPUÉS de que la promesa resuelve (commit ya hecho) se
    // inspecciona el outcome y se throwea AFUERA — el mismo patrón que ya
    // usa el camino secuencial de reuso más arriba (líneas ~307-321).
    const outcome = await this.prisma.withTenantContext(
      row.tenantId,
      async (tx): Promise<RefreshOutcome> => {
        const user = await this.authRepository.findUserById(tx, row.userId);

        // AUTH-REQ-11: re-chequeo de estado EN CADA rotación — una
        // suspensión aplicada a mitad de sesión corta el refresh acá.
        if (user === null || user.status !== "active") {
          // W7 (verify #271): revocar la familia también acá — sin esto el
          // refresh token de un usuario suspendido queda vivo
          // (usedAt=null, revokedAt=null) hasta expirar por su cuenta; si
          // se levanta la suspensión, una sesión robada previa revive.
          await this.refreshTokenService.revokeFamily(tx, row.familyId);
          return { kind: "suspended" };
        }

        const rotated = await this.refreshTokenService.markUsedOrRevokeFamily(
          tx,
          row.id,
          row.familyId,
        );

        if (!rotated) {
          await this.auditService.record(tx, {
            tenantId: row.tenantId,
            userId: row.userId,
            action: "auth.refresh.reuse_detected",
            resourceType: "refresh_token_family",
            resourceId: row.familyId,
            ip: meta.ip,
            userAgent: meta.userAgent,
          });
          return { kind: "reused" };
        }

        // Permisos re-resueltos FRESCOS desde DB (design §4): es lo que
        // hace que un epoch bumpeado (AD-8) propague apenas el usuario
        // refresca.
        const permissions = await this.authRepository.resolvePermissionCodes(tx, user.id);
        const { token: newRawToken, tokenHash: newTokenHash } = this.oneTimeTokenService.generate();
        const refreshExpiresAt = this.refreshTokenService.buildExpiry();

        await this.authRepository.createRefreshToken(tx, {
          tenantId: row.tenantId,
          userId: user.id,
          tokenHash: newTokenHash,
          familyId: row.familyId,
          expiresAt: refreshExpiresAt,
        });

        const locale = user.locale as "es" | "en";
        const accessToken = this.tokenService.signAccessToken({
          sub: user.id,
          tenantId: row.tenantId,
          permissions,
          locale,
        });

        return {
          kind: "ok",
          result: {
            accessToken,
            expiresIn: this.accessTtlSeconds,
            refreshToken: newRawToken,
            refreshExpiresAt,
          },
        };
      },
    );

    if (outcome.kind === "suspended") {
      throw new ForbiddenException({ message: "auth.account_suspended" });
    }
    if (outcome.kind === "reused") {
      throw new UnauthorizedException({ message: "auth.token_reused" });
    }
    return outcome.result;
  }

  /**
   * AUTH-REQ-07: revoca la FAMILIA entera (no solo el token) — cerrar
   * sesión en un dispositivo no debe dejar un token rotable colgando.
   * Silencioso a propósito: sin cookie, token inexistente o ya revocado,
   * el resultado observable es el mismo (204) — el controller SIEMPRE
   * limpia la cookie después de llamar acá.
   */
  async logout(rawToken: string | undefined, meta: RequestMeta): Promise<void> {
    if (!rawToken) {
      return;
    }

    const tokenHash = this.oneTimeTokenService.hash(rawToken);
    const row = await this.authRepository.findRefreshTokenByHash(tokenHash);

    if (!row) {
      return;
    }

    await this.prisma.withTenantContext(row.tenantId, async (tx) => {
      await this.refreshTokenService.revokeFamily(tx, row.familyId);
      await this.auditService.record(tx, {
        tenantId: row.tenantId,
        userId: row.userId,
        action: "auth.logout",
        resourceType: "user",
        resourceId: row.userId,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
    });
  }

  /**
   * AUTH-REQ-08 (design §4): a prueba de enumeración — SIEMPRE resuelve sin
   * error, exista o no el email; el controller responde el MISMO 202 en
   * ambos casos. El trabajo real (invalidar tokens previos + crear uno
   * nuevo + mail) solo ocurre si el email existe.
   */
  // `meta` (ip/userAgent) se recibe por simetría con el resto del módulo
  // pero NO se usa: AUTH-REQ-15 no exige auditar forgot-password (solo el
  // reset completado), y filtrar más info acá arriesgaría enumeración.
  async forgotPassword(email: string, _meta: RequestMeta): Promise<void> {
    const tenantId = await this.authRepository.resolveTenantByEmail(email);

    if (!tenantId) {
      return;
    }

    // AD-1: lectura CORTA dentro de withTenantContext (users tiene RLS);
    // cierra antes de tocar password_reset_tokens (sin RLS, AD-3).
    const user = await this.prisma.withTenantContext(tenantId, (tx) =>
      this.authRepository.findUserByTenantAndEmail(tx, tenantId, email),
    );

    if (!user) {
      return;
    }

    const now = this.clock.now();
    // Design §4: invalidar tokens de reset previos SIN usar del usuario
    // antes de emitir uno nuevo.
    await this.authRepository.invalidatePendingPasswordResetTokens(user.id, now);

    const { token, tokenHash } = this.oneTimeTokenService.generate();
    const expiresAt = new Date(now.getTime() + PASSWORD_RESET_TTL_MS);

    await this.authRepository.createPasswordResetToken({
      tenantId,
      userId: user.id,
      tokenHash,
      expiresAt,
    });

    // D3 (#347): fragmento, no query string — ver nota en registerTenant().
    const link = `${this.appUrl}/reset-password#token=${token}`;
    const locale = user.locale as "es" | "en";

    // Fire-and-forget (AD-9): un fallo del proveedor de mail JAMÁS rompe el
    // request.
    this.mailer
      .send({
        to: user.email,
        template: "reset-password",
        vars: { firstName: user.firstName, link },
        locale,
      })
      .catch((error: unknown) => {
        this.logger.error(
          `Fallo al enviar mail de reset de password a ${user.email}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
  }

  /**
   * AUTH-REQ-09/10/13 (design §4): password nuevo + token consumido +
   * TODAS las familias de refresh revocadas (no solo una, a diferencia de
   * logout) + bump de `perm-epoch:{userId}` (mata los access tokens vivos,
   * AD-8) + audit `auth.password.reset`.
   */
  async resetPassword(token: string, password: string, meta: RequestMeta): Promise<void> {
    const tokenHash = this.oneTimeTokenService.hash(token);
    const row = await this.authRepository.findPasswordResetTokenByHash(tokenHash);
    const now = this.clock.now();

    // Misma clave para inexistente/usado/expirado (mismo criterio que
    // verify-email): no le decimos al atacante en cuál se equivocó.
    if (!row || row.usedAt !== null || row.expiresAt < now) {
      throw new BadRequestException({ message: "auth.token_invalid" });
    }

    // AD-1: argon2 (~80-150ms) SIEMPRE fuera de cualquier $transaction.
    const passwordHash = await this.hasher.hash(password);

    await this.prisma.withTenantContext(row.tenantId, async (tx) => {
      const user = await this.authRepository.findUserById(tx, row.userId);
      // Design §4: usar el link de reset prueba el control del email — si
      // todavía no estaba verificado, el reset lo verifica de paso.
      const emailVerifiedAt = user && user.emailVerifiedAt === null ? now : null;
      // Y si esa verificación ocurre sobre un usuario invited, se promueve
      // a active con la MISMA semántica que verify-email — sin esto queda
      // un estado roto: login pasa (chequea emailVerifiedAt) pero el primer
      // refresh expulsa (exige active). suspended jamás se promueve: la
      // suspensión es administrativa, no de verificación.
      const promoteToActive = emailVerifiedAt !== null && user?.status === "invited";

      await this.authRepository.updateUserPassword(
        tx,
        row.userId,
        passwordHash,
        emailVerifiedAt,
        promoteToActive,
      );
      await this.authRepository.markPasswordResetTokenUsed(tx, row.id, now);
      // AUTH-REQ-09: TODAS las familias del usuario, no solo una (logout
      // solo revoca la familia de la sesión actual).
      await this.authRepository.revokeAllRefreshTokensForUser(tx, row.userId, now);
      await this.auditService.record(tx, {
        tenantId: row.tenantId,
        userId: row.userId,
        action: "auth.password.reset",
        resourceType: "user",
        resourceId: row.userId,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
    });

    await this.bumpPermEpoch(row.userId, now);
  }

  /**
   * W1 del backlog de f1-auth (AUTH-REQ-10/13) — cambio de password de un
   * usuario YA autenticado. La secuencia es la parte peligrosa y está fijada
   * por tests; no reordenar:
   *
   * 1. Verificar `currentPassword` → 401 `auth.invalid_credentials`, la MISMA
   *    clave que login: un 401 distinto acá le diría a quien robó un access
   *    token que la cuenta existe y que solo le falta la password.
   * 2. Recién entonces validar la política de la password nueva. Al revés, un
   *    atacante con token robado sabría si su intento fue rechazado por la
   *    política (400) o por la password (401) — y cada intento fallido
   *    quedaría sin auditar.
   * 3. Hashear FUERA de toda transacción (AD-1: argon2 son ~80-150ms
   *    reteniendo una conexión del pool de 50).
   * 4. En una sola tx: password + revocación de las OTRAS familias + audit.
   * 5. Bump de `perm-epoch:{userId}` DESPUÉS del commit (AD-8) — mata los
   *    access tokens vivos de las otras sesiones.
   * 6. Y RECIÉN AHÍ firmar el token nuevo. `JwtAuthGuard` compara
   *    `iat < maxEpoch`: firmar antes del bump devolvería un token nacido
   *    muerto y el usuario se auto-expulsaría al cambiar su propia password.
   *
   * Defensa en profundidad sobre el paso 6: aunque el cliente ignore el
   * token devuelto, su próxima request dará 401 y el interceptor de refresh
   * lo recupera solo, porque su familia sigue viva (es la única que no
   * revocamos). Eso NO es excusa para no devolverlo — es la red debajo.
   */
  async changePassword(
    user: AuthUser,
    input: ChangePasswordInput,
    rawRefreshToken: string | undefined,
    meta: RequestMeta,
  ): Promise<ChangePasswordResult> {
    const now = this.clock.now();

    // AD-1: lectura CORTA, cierra antes de verificar el hash.
    const row = await this.prisma.withTenantContext(user.tenantId, (tx) =>
      this.authRepository.findUserById(tx, user.userId),
    );

    // `passwordHash === null` es un usuario invitado que nunca fijó password:
    // no puede haber llegado hasta acá con un JWT, pero si llegara, el
    // `verify` contra el dummy mantiene el costo constante y el 401 idéntico.
    const passwordValid = await this.hasher.verify(
      row?.passwordHash ?? this.dummyHash,
      input.currentPassword,
    );

    if (!row || row.passwordHash === null || !passwordValid) {
      await this.prisma.withTenantContext(user.tenantId, (tx) =>
        this.auditService.record(tx, {
          tenantId: user.tenantId,
          userId: user.userId,
          action: "auth.password.change_failed",
          resourceType: "user",
          resourceId: user.userId,
          ip: meta.ip,
          userAgent: meta.userAgent,
        }),
      );
      throw new UnauthorizedException({ message: "auth.invalid_credentials" });
    }

    // Paso 2: MISMO validador que register y reset (AUTH-REQ-10 exige la
    // misma política en los tres) — importado del DTO, no reescrito acá.
    if (!passwordSchema.safeParse(input.newPassword).success) {
      throw new BadRequestException({ message: "auth.weak_password" });
    }

    // Paso 3: AD-1, argon2 SIEMPRE fuera de cualquier $transaction.
    const passwordHash = await this.hasher.hash(input.newPassword);

    const currentFamilyId = await this.resolveOwnFamilyId(rawRefreshToken, user.userId);

    const permissions = await this.prisma.withTenantContext(user.tenantId, async (tx) => {
      await this.authRepository.updateUserPassword(tx, user.userId, passwordHash, null, false);
      await this.authRepository.revokeOtherRefreshTokenFamiliesForUser(
        tx,
        user.userId,
        currentFamilyId,
        now,
      );
      await this.auditService.record(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: "auth.password.changed",
        resourceType: "user",
        resourceId: user.userId,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      // Frescos de DB, igual que en cada rotación de refresh.
      return this.authRepository.resolvePermissionCodes(tx, user.userId);
    });

    // Paso 5 ANTES del paso 6 — ver el docblock. El reloj se relee acá para
    // que el epoch quede lo más tarde posible (los ~100ms del argon2 de
    // arriba son ventana en la que otra sesión podría emitir un token).
    //
    // Por qué este orden es una GARANTÍA y no una casualidad: `iat` y el
    // epoch se miden ambos en unix SEGUNDOS. Con bump antes de la firma,
    // `signTime >= bumpTime` ⇒ `floor(signTime) >= floor(bumpTime)` ⇒
    // `iat >= epoch` SIEMPRE, y el guard (`iat < maxEpoch`) nunca lo rechaza.
    // Invertirlo no rompe siempre: rompe solo cuando la firma y el bump caen
    // a ambos lados de un borde de segundo — un deslogueo intermitente
    // imposible de reproducir en soporte. Por eso el candado de este orden es
    // el test UNITARIO de `invocationCallOrder` en auth.service.spec.ts: el
    // e2e verifica el resultado, pero con granularidad de segundo no puede
    // distinguir el orden de forma determinista.
    await this.bumpPermEpoch(user.userId, this.clock.now());

    const accessToken = this.tokenService.signAccessToken({
      sub: user.userId,
      tenantId: user.tenantId,
      permissions,
      locale: row.locale as "es" | "en",
    });

    return { accessToken, expiresIn: this.accessTtlSeconds };
  }

  /**
   * F1-WEB-AUTH-10: sesiones activas del usuario = familias de refresh vivas.
   * `RefreshToken` no guarda userAgent ni IP, así que se devuelve solo lo que
   * existe; el agrupado por familia vive en una función pura testeada aparte.
   */
  async listSessions(
    user: AuthUser,
    rawRefreshToken: string | undefined,
  ): Promise<SessionSummary[]> {
    const rows = await this.authRepository.findActiveRefreshTokensForUser(
      user.tenantId,
      user.userId,
      this.clock.now(),
    );
    const currentFamilyId = await this.resolveOwnFamilyId(rawRefreshToken, user.userId);

    return groupSessionsByFamily(rows, currentFamilyId);
  }

  /**
   * La familia de la cookie `sp_refresh` de ESTE request, o `null` si no hay
   * cookie, el token no existe, o la fila pertenece a OTRO usuario. Ese
   * último chequeo no es paranoia decorativa: sin él, presentar la cookie de
   * un tercero decidiría qué familia se preserva / se marca como "esta
   * sesión".
   */
  private async resolveOwnFamilyId(
    rawRefreshToken: string | undefined,
    userId: string,
  ): Promise<string | null> {
    if (!rawRefreshToken) {
      return null;
    }

    const row = await this.authRepository.findRefreshTokenByHash(
      this.oneTimeTokenService.hash(rawRefreshToken),
    );

    return row && row.userId === userId ? row.familyId : null;
  }

  /**
   * Libera los contadores de throttle tras una autenticación EXITOSA (ver el
   * comentario en `login`). Fail-open con WARN, mismo criterio que el resto
   * de lo que toca Redis: si Redis no responde, el peor caso es que el
   * usuario conserve un contador que expira solo en 15 min — nunca romper un
   * login que ya fue válido.
   */
  private async clearAuthThrottle(ip: string | undefined, email: string): Promise<void> {
    const normalizedEmail = normalizeThrottleEmail(email);
    const keys = [
      authIpThrottleKey(ip),
      ...(normalizedEmail ? [authEmailThrottleKey(normalizedEmail)] : []),
    ];

    try {
      await this.redis.del(...keys);
    } catch (error) {
      this.logger.warn(
        `Redis inalcanzable al liberar el throttle tras un login exitoso: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * AD-8: `SET` SIN TTL (inevictable con volatile-ttl) — valor en unix
   * SEGUNDOS, misma unidad que `iat`. Fail-open consciente si Redis está
   * caído (mismo criterio que JwtAuthGuard): el peor caso es degradar a la
   * revocación de refresh tokens ya garantizada por la tx de arriba; el
   * access token viejo (15 min) sigue vivo hasta expirar por su cuenta.
   */
  private async bumpPermEpoch(userId: string, now: Date): Promise<void> {
    try {
      await this.redis.set(`perm-epoch:${userId}`, String(Math.floor(now.getTime() / 1000)));
    } catch (error) {
      this.logger.warn(
        `Redis inalcanzable al bumpear perm-epoch:${userId}, fail-open: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface LoginResult {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshExpiresAt: Date;
  user: {
    id: string;
    email: string;
    firstName: string;
    locale: "es" | "en";
    permissions: string[];
    // A1 del design de f1-web-onboard: MISMO shape que `MeProfile.tenant`
    // (users.service.ts) — evita el store con dos emisores divergentes.
    tenant: TenantBlock;
  };
}

export interface RefreshResult {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshExpiresAt: Date;
}

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}

export interface ChangePasswordResult {
  accessToken: string;
  expiresIn: number;
}

// C1 (verify #271): discriminada para que el callback de `withTenantContext`
// en `refresh()` NUNCA throwee — ver el comentario en `refresh()`.
type RefreshOutcome =
  | { kind: "suspended" }
  | { kind: "reused" }
  | { kind: "ok"; result: RefreshResult };
