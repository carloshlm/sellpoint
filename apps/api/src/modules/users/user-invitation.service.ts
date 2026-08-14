import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Env } from "../../config/env.schema";
import { CLOCK, type ClockPort } from "../../infrastructure/clock/clock.port";
import { AuthRepository } from "../auth/repositories/auth.repository";
import { OneTimeTokenService } from "../auth/services/one-time-token.service";
import { MAILER, type MailerPort } from "../mail/mailer.port";

/**
 * Una invitación NO es un reset: quien la recibe no estaba esperando el mail
 * y puede tardar en leerlo. 30 min (`PASSWORD_RESET_TTL_MS`) dejaría el link
 * muerto antes de que el colega abra la bandeja; 7 días es la ventana en la
 * que un alta administrativa sigue siendo relevante. Es SOLO un `expiresAt`
 * distinto — misma tabla, mismo hash, mismo un-solo-uso.
 */
export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface SendInvitationInput {
  tenantId: string;
  userId: string;
  email: string;
  firstName: string;
  locale: "es" | "en";
}

/**
 * Gap S1 (backlog de f1-rbac, heredado de f1-auth): `POST /users` creaba un
 * usuario `invited`, sin password y sin mail — o sea, sin NINGUNA forma de
 * entrar. El CRUD administrativo no era usable de punta a punta.
 *
 * La emisión REUSA el flujo de reset de password (`PasswordResetToken` +
 * `POST /auth/reset-password`) en vez de inventar un mecanismo nuevo, porque
 * el invitado necesita exactamente las dos cosas que ese flujo ya hace y ya
 * tiene testeadas: probar el control del email Y definir una password.
 * `AuthService.resetPassword` además promueve `invited -> active` y setea
 * `emailVerifiedAt` cuando estaba en NULL (fix del "estado zombie", commit
 * 474b183), así que aceptar la invitación deja al usuario listo para loguear
 * sin código nuevo en el canje.
 *
 * `verify-email` NO servía: solo activa, y dejaría al usuario `active` pero
 * SIN password — el mismo callejón sin salida, corrido de lugar.
 */
@Injectable()
export class UserInvitationService {
  private readonly logger = new Logger(UserInvitationService.name);
  private readonly appUrl: string;

  constructor(
    private readonly authRepository: AuthRepository,
    private readonly oneTimeTokenService: OneTimeTokenService,
    @Inject(MAILER) private readonly mailer: MailerPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    configService: ConfigService<Env, true>,
  ) {
    this.appUrl = configService.get("APP_URL", { infer: true });
  }

  /**
   * Se llama SIEMPRE post-commit del alta (mismo criterio que
   * `registerTenant`/`forgotPassword`): `password_reset_tokens` no tiene RLS
   * (AD-3) y no debe atarse a la transacción de dominio.
   *
   * El token SÍ se espera (si la DB falla, el alta debe enterarse); el mail
   * es fire-and-forget (AD-9): hoy Resend rebota por SPF/DKIM sin verificar
   * y eso NO puede tumbar un `POST /users` que ya comiteó.
   */
  async send(input: SendInvitationInput): Promise<void> {
    const now = this.clock.now();

    // Mismo criterio que forgot-password: un solo link canjeable por vez.
    // Sin esto, un `resend-invitation` dejaría vivo el link anterior.
    await this.authRepository.invalidatePendingPasswordResetTokens(input.userId, now);

    const { token, tokenHash } = this.oneTimeTokenService.generate();

    await this.authRepository.createPasswordResetToken({
      tenantId: input.tenantId,
      userId: input.userId,
      tokenHash,
      expiresAt: new Date(now.getTime() + INVITATION_TTL_MS),
    });

    const link = `${this.appUrl}/accept-invitation?token=${token}`;

    this.mailer
      .send({
        to: input.email,
        template: "invite-user",
        vars: { firstName: input.firstName, link },
        locale: input.locale,
      })
      .catch((error: unknown) => {
        this.logger.error(
          `Fallo al enviar la invitación a ${input.email}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
  }
}
