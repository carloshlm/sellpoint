import { Injectable } from "@nestjs/common";
import { icd10CodePrefix, normalizeSearchText } from "@sellpoint/shared";
import { Prisma } from "../../generated/prisma/client";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import type { Icd10Query } from "./dto/icd10.dto";

export interface Icd10Hit {
  code: string;
  title: string;
  chapter: string | null;
  sex: string | null;
}

/** `%` y `_` son comodines de LIKE: escapados, buscan lo que el médico tecleó. */
const escaparLike = (texto: string) => texto.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * F9-CLINIC-HC-22 — el buscador del catálogo CIE-10 (México, DGIS).
 *
 * El catálogo es GLOBAL (sin tenant, sin RLS): se consulta sin contexto de
 * negocio. Si lo tecleado parece un código (`j06`, `J06.9`) se busca por
 * prefijo del código con punto, en orden de código. Si es texto, por el
 * título sin acentos ni mayúsculas (`search`) y en orden de RELEVANCIA: la
 * coincidencia más al inicio primero, después el título más corto, después
 * el código — «faringitis» trae «FARINGITIS AGUDA, NO ESPECIFICADA» antes
 * que «RINOFARINGITIS AGUDA». Solo vuelven los códigos VIGENTES para
 * codificar: una categoría con subcategorías (`E11`) no se ofrece, sus hijas
 * sí.
 */
@Injectable()
export class Icd10Service {
  constructor(private readonly prisma: PrismaService) {}

  async search(query: Icd10Query): Promise<Icd10Hit[]> {
    const prefijo = icd10CodePrefix(query.q);
    if (prefijo !== null) {
      return this.prisma.medicalClinicIcd10Code.findMany({
        where: { isValid: true, code: { startsWith: prefijo } },
        orderBy: { code: "asc" },
        take: query.limit,
        select: { code: true, title: true, chapter: true, sex: true },
      });
    }
    const texto = normalizeSearchText(query.q);
    const patron = `%${escaparLike(texto)}%`;
    return this.prisma.$queryRaw<Icd10Hit[]>(Prisma.sql`
      SELECT "code", "title", "chapter", "sex"
      FROM "medical_clinic_icd10_codes"
      WHERE "is_valid" AND "search" LIKE ${patron} ESCAPE '\\'
      ORDER BY position(${texto} IN "search"), length("search"), "code"
      LIMIT ${query.limit}`);
  }
}
