import { Body, Controller, Get, Patch, Req } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import type { AuthUser } from "../auth/types/auth-user";
import { AllowedInFreeTier } from "../billing/decorators/allowed-in-free-tier.decorator";
import { type UpdateMeDto, updateMeSchema } from "./dto/update-me.dto";
import { UsersService } from "./users.service";

// Sin @Public(): JwtAuthGuard global (secure by default, f1-auth AD-8) exige
// JWT válido. @CurrentUser() lee req.user, poblado por el guard.
@ApiTags("users")
@Controller()
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get("me")
  me(@CurrentUser() user: AuthUser) {
    return this.usersService.getMe(user);
  }

  @AllowedInFreeTier()
  @Patch("me")
  updateMe(
    @Body(new ZodValidationPipe(updateMeSchema, "users.invalid_body")) dto: UpdateMeDto,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ) {
    return this.usersService.updateMe(user, dto, {
      ip: request.ip,
      userAgent: request.headers["user-agent"],
    });
  }
}
