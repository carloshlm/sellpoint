import { Body, Controller, HttpCode, HttpStatus, Post, Req, Res } from "@nestjs/common";
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
import { Public } from "./decorators/public.decorator";
import { type LoginDto, loginSchema } from "./dto/login.dto";
import { type RegisterTenantDto, registerTenantSchema } from "./dto/register-tenant.dto";
import { type VerifyEmailDto, verifyEmailSchema } from "./dto/verify-email.dto";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

@ApiTags("auth")
@Controller("auth")
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
}
