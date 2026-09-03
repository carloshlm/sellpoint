import { Body, Controller, Get, Post, Query, Req } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { CurrentUserScope } from "../../infrastructure/warehouse-scope/current-user-scope.decorator";
import type { UserScope } from "../../infrastructure/warehouse-scope/request-warehouse-scope";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator";
import type { AuthUser } from "../auth/types/auth-user";
import { RequiresModule } from "../billing/decorators/requires-module.decorator";
import { type CreateCustomerDto, createCustomerSchema } from "../reception/dto/upsert-customer.dto";
import { type SearchPatientsQuery, searchPatientsSchema } from "./dto/search-patients.dto";
import { type StockSearchQuery, stockSearchQuerySchema } from "./dto/stock-search.dto";
import { PatientsService } from "./patients.service";
import { StockSearchService } from "./stock-search.service";

/**
 * F9-CLINIC-09/13 — atender: buscar al paciente (por nombre o por turno de
 * hoy), darlo de alta y buscar medicamentos en el stock del médico. Todo con
 * `medical_clinic:attend`: la recepcionista, con `:read`, no entra aquí.
 */
@ApiTags("medical-clinic")
@RequiresModule("medical_clinic")
@Controller("medical-clinic")
export class MedicalClinicPatientsController {
  constructor(
    private readonly patients: PatientsService,
    private readonly stock: StockSearchService,
  ) {}

  @Get("patients/search")
  @RequirePermissions("medical_clinic:attend")
  search(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(searchPatientsSchema, "medical_clinic.invalid_query"))
    query: SearchPatientsQuery,
  ) {
    return this.patients.search(user, query);
  }

  @Post("patients")
  @RequirePermissions("medical_clinic:attend")
  create(
    @Body(new ZodValidationPipe(createCustomerSchema, "reception.invalid_body"))
    dto: CreateCustomerDto,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ) {
    return this.patients.create(user, dto, {
      ip: request.ip,
      userAgent: request.headers["user-agent"],
    });
  }

  @Get("stock-search")
  @RequirePermissions("medical_clinic:attend")
  stockSearch(
    @CurrentUser() user: AuthUser,
    @CurrentUserScope() scope: UserScope,
    @Query(new ZodValidationPipe(stockSearchQuerySchema, "medical_clinic.invalid_query"))
    query: StockSearchQuery,
  ) {
    return this.stock.search(user, scope, query);
  }
}
