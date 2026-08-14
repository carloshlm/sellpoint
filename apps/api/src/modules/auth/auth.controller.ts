import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import type { Env } from "../../config/env.schema";
import { getLocale, type RequestWithLocale } from "../../i18n/request-locale";
import { AuthService } from "./auth.service";
import {
  buildClearedRefreshCookieOptions,
  buildRefreshCookieOptions,
  REFRESH_COOKIE_NAME,
  type RefreshCookieEnv,
} from "./cookie/refresh-cookie";
import { CurrentUser } from "./decorators/current-user.decorator";
import { Public } from "./decorators/public.decorator";
import { type ChangePasswordDto, changePasswordSchema } from "./dto/change-password.dto";
import { type ForgotPasswordDto, forgotPasswordSchema } from "./dto/forgot-password.dto";
import { type LoginDto, loginSchema } from "./dto/login.dto";
import { type RegisterTenantDto, registerTenantSchema } from "./dto/register-tenant.dto";
import { type ResetPasswordDto, resetPasswordSchema } from "./dto/reset-password.dto";
import { type VerifyEmailDto, verifyEmailSchema } from "./dto/verify-email.dto";
import { AuthEmailThrottlerGuard } from "./guards/auth-email-throttler.guard";
import type { AuthUser } from "./types/auth-user";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// f1-auth AUTH-REQ-12/U6-02: guard aplicado a NIVEL DE CONTROLLER — cubre
// las 8 rutas de /auth/* con el chequeo de IP (design AD-7: "/auth/*"
// entero); el guard mismo restringe internamente el chequeo de email a
// login/forgot-password (EMAIL_TRACKED_HANDLERS).
@ApiTags("auth")
@Controller("auth")
@UseGuards(AuthEmailThrottlerGuard)
export class AuthController {
  private readonly cookieEnv: RefreshCookieEnv;
  private readonly refreshTtlMs: number;

  constructor(
    private readonly authService: AuthService,
    configService: ConfigService<Env, true>,
  ) {
    this.cookieEnv = {
      NODE_ENV: configService.get("NODE_ENV", { infer: true }),
      REFRESH_COOKIE_PATH: configService.get("REFRESH_COOKIE_PATH", { infer: true }),
    };
    this.refreshTtlMs = configService.get("REFRESH_TOKEN_TTL_DAYS", { infer: true }) * MS_PER_DAY;
  }

  @Public()
  @Post("register-tenant")
  @HttpCode(HttpStatus.CREATED)
  registerTenant(
    @Body(new ZodValidationPipe(registerTenantSchema, "auth.invalid_body")) dto: RegisterTenantDto,
    @Req() request: Request & RequestWithLocale,
  ) {
    // F1-LOCALE-09: si el body no trae `locale` explícito, cae al que
    // LocaleResolverMiddleware ya resolvió desde Accept-Language (no hay
    // Authorization en signup, así que acá la cascada práctica es
    // Accept-Language -> DEFAULT_LOCALE).
    return this.authService.registerTenant(
      { ...dto, locale: dto.locale ?? getLocale(request) },
      {
        ip: request.ip,
        userAgent: request.headers["user-agent"],
      },
    );
  }

  // POST, no GET (design §4): los escáneres de links de Outlook/Gmail hacen
  // prefetch de los GET y quemarían el token de un solo uso.
  @Public()
  @Post("verify-email")
  @HttpCode(HttpStatus.OK)
  async verifyEmail(
    @Body(new ZodValidationPipe(verifyEmailSchema, "auth.token_invalid")) dto: VerifyEmailDto,
    @Req() request: Request,
  ): Promise<{ verified: true }> {
    await this.authService.verifyEmail(dto.token, {
      ip: request.ip,
      userAgent: request.headers["user-agent"],
    });
    return { verified: true };
  }

  @Public()
  @Post("login")
  @HttpCode(HttpStatus.OK)
  async login(
    @Body(new ZodValidationPipe(loginSchema, "auth.invalid_credentials")) dto: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.login(dto, {
      ip: request.ip,
      userAgent: request.headers["user-agent"],
    });

    response.cookie(
      REFRESH_COOKIE_NAME,
      result.refreshToken,
      buildRefreshCookieOptions(this.cookieEnv, this.refreshTtlMs),
    );

    return {
      accessToken: result.accessToken,
      expiresIn: result.expiresIn,
      user: result.user,
    };
  }

  // AUTH-REQ-05/06: cualquier fallo (token ausente/inválido/reusado/expirado)
  // limpia la cookie — un catch genérico evita duplicar esa lógica en cada
  // rama del servicio.
  @Public()
  @Post("refresh")
  @HttpCode(HttpStatus.OK)
  async refresh(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const rawToken = request.cookies?.[REFRESH_COOKIE_NAME] as string | undefined;

    try {
      const result = await this.authService.refresh(rawToken, {
        ip: request.ip,
        userAgent: request.headers["user-agent"],
      });

      response.cookie(
        REFRESH_COOKIE_NAME,
        result.refreshToken,
        buildRefreshCookieOptions(this.cookieEnv, this.refreshTtlMs),
      );

      return { accessToken: result.accessToken, expiresIn: result.expiresIn };
    } catch (error) {
      response.cookie(REFRESH_COOKIE_NAME, "", buildClearedRefreshCookieOptions(this.cookieEnv));
      throw error;
    }
  }

  @Public()
  @Post("logout")
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    const rawToken = request.cookies?.[REFRESH_COOKIE_NAME] as string | undefined;

    await this.authService.logout(rawToken, {
      ip: request.ip,
      userAgent: request.headers["user-agent"],
    });

    response.cookie(REFRESH_COOKIE_NAME, "", buildClearedRefreshCookieOptions(this.cookieEnv));
  }

  // AUTH-REQ-08 (a prueba de enumeración): SIEMPRE 202 con el MISMO body,
  // exista o no el email — el trabajo real (token + mail) vive adentro de
  // authService.forgotPassword y nunca se filtra acá.
  @Public()
  @Post("forgot-password")
  @HttpCode(HttpStatus.ACCEPTED)
  async forgotPassword(
    @Body(new ZodValidationPipe(forgotPasswordSchema, "auth.invalid_body")) dto: ForgotPasswordDto,
    @Req() request: Request,
  ): Promise<{ accepted: true }> {
    await this.authService.forgotPassword(dto.email, {
      ip: request.ip,
      userAgent: request.headers["user-agent"],
    });
    return { accepted: true };
  }

  @Public()
  @Post("reset-password")
  @HttpCode(HttpStatus.NO_CONTENT)
  async resetPassword(
    @Body(new ZodValidationPipe(resetPasswordSchema, "auth.token_invalid")) dto: ResetPasswordDto,
    @Req() request: Request,
  ): Promise<void> {
    await this.authService.resetPassword(dto.token, dto.password, {
      ip: request.ip,
      userAgent: request.headers["user-agent"],
    });
  }

  /**
   * W1 de f1-auth. SIN `@Public()`: el JwtAuthGuard global exige un access
   * token válido. La cookie `sp_refresh` viaja igual (su path es `/auth`) y
   * es la que identifica cuál familia NO revocar — la sesión desde la que el
   * usuario está cambiando su password sobrevive; las otras mueren.
   *
   * Devuelve un access token NUEVO firmado DESPUÉS del bump de epoch: el
   * cliente debe guardarlo, porque el que traía quedó obsoleto en el mismo
   * bump que mató a las otras sesiones.
   */
  @Post("change-password")
  @HttpCode(HttpStatus.OK)
  changePassword(
    @Body(new ZodValidationPipe(changePasswordSchema, "auth.invalid_body"))
    dto: ChangePasswordDto,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ) {
    return this.authService.changePassword(
      user,
      dto,
      request.cookies?.[REFRESH_COOKIE_NAME] as string | undefined,
      { ip: request.ip, userAgent: request.headers["user-agent"] },
    );
  }

  /**
   * F1-WEB-AUTH-10: sesiones activas (= familias de refresh vivas). También
   * autenticado. `RefreshToken` no guarda userAgent ni IP, así que la lista
   * expone solo lo que existe — y JAMÁS el hash del token.
   *
   * El nombre del método es el contrato del exento de throttle en
   * `AuthEmailThrottlerGuard` (`IP_THROTTLE_EXEMPT_HANDLERS`); si se renombra,
   * el guard vuelve a aplicarle 5/900s por IP y el test de allá lo grita.
   */
  @Get("sessions")
  listSessions(@CurrentUser() user: AuthUser, @Req() request: Request) {
    return this.authService.listSessions(
      user,
      request.cookies?.[REFRESH_COOKIE_NAME] as string | undefined,
    );
  }
}
