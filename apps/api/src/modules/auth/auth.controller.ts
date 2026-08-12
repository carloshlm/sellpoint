import { Body, Controller, HttpCode, HttpStatus, Post, Req } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { AuthService } from "./auth.service";
import { Public } from "./decorators/public.decorator";
import { type RegisterTenantDto, registerTenantSchema } from "./dto/register-tenant.dto";
import { type VerifyEmailDto, verifyEmailSchema } from "./dto/verify-email.dto";

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post("register-tenant")
  @HttpCode(HttpStatus.CREATED)
  registerTenant(
    @Body(new ZodValidationPipe(registerTenantSchema, "auth.invalid_body")) dto: RegisterTenantDto,
    @Req() request: Request,
  ) {
    return this.authService.registerTenant(dto, {
      ip: request.ip,
      userAgent: request.headers["user-agent"],
    });
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
}
