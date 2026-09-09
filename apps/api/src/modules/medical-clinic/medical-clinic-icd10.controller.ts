import { Controller, Get, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator";
import { RequiresModule } from "../billing/decorators/requires-module.decorator";
import { type Icd10Query, icd10QuerySchema } from "./dto/icd10.dto";
import { Icd10Service } from "./icd10.service";

/**
 * F9-CLINIC-HC-22 — `GET /medical-clinic/icd10?q=`: el catálogo CIE-10 para
 * quien captura diagnósticos (`medical_clinic:attend`). Es global, pero se
 * gatea con el módulo y el permiso igual que el resto del expediente.
 */
@ApiTags("medical-clinic")
@RequiresModule("medical_clinic")
@Controller("medical-clinic/icd10")
export class MedicalClinicIcd10Controller {
  constructor(private readonly icd10: Icd10Service) {}

  @Get()
  @RequirePermissions("medical_clinic:attend")
  search(
    @Query(new ZodValidationPipe(icd10QuerySchema, "medical_clinic.invalid_query"))
    query: Icd10Query,
  ) {
    return this.icd10.search(query);
  }
}
