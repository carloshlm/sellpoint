import { Injectable } from "@nestjs/common";
import type { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import {
  type StudyCatalogConfig,
  StudyCatalogService,
  type StudyDelegate,
} from "./study-catalog.service";

/** F9-CLINIC-07 — Estudios de Laboratorio. Toda la lógica vive en la base. */
@Injectable()
export class LabStudiesService extends StudyCatalogService {
  protected readonly config: StudyCatalogConfig = {
    resource: "lab_study",
    notFoundKey: "medical_clinic.lab_study_not_found",
    // El delegate real tiene firmas genéricas; se presenta con la forma mínima.
    delegate: (tx: Prisma.TransactionClient) =>
      tx.medicalClinicLabStudy as unknown as StudyDelegate,
  };

  constructor(prisma: PrismaService, auditService: AuditService) {
    super(prisma, auditService);
  }
}
