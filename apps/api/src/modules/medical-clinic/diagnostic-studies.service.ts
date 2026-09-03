import { Injectable } from "@nestjs/common";
import type { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import {
  type StudyCatalogConfig,
  StudyCatalogService,
  type StudyDelegate,
} from "./study-catalog.service";

/** F9-CLINIC-08 — Estudios Diagnósticos (gabinete). Toda la lógica vive en la base. */
@Injectable()
export class DiagnosticStudiesService extends StudyCatalogService {
  protected readonly config: StudyCatalogConfig = {
    resource: "diagnostic_study",
    notFoundKey: "medical_clinic.diagnostic_study_not_found",
    delegate: (tx: Prisma.TransactionClient) =>
      tx.medicalClinicDiagnosticStudy as unknown as StudyDelegate,
  };

  constructor(prisma: PrismaService, auditService: AuditService) {
    super(prisma, auditService);
  }
}
