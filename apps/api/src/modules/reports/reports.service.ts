import { Injectable } from "@nestjs/common";
import { MAX_EXPORT_ROWS } from "../../common/spreadsheet/export-guard";

/**
 * Un reporte del hub, con el permiso que hay que tener para pedirlo.
 *
 * El permiso viaja como DATO y no queda hardcodeado en el front porque no es
 * uniforme: seis reportes son `reports:read` y dos —vencimientos y tránsito—
 * son `inventory:read`, por el criterio de la atomización de que exportar una
 * pantalla es la MISMA lectura en otro formato. Duplicar esa matriz en el
 * cliente garantiza que un día diga algo distinto del servidor.
 */
export interface ReportDescriptor {
  key: string;
  permission: string;
}

/**
 * Las 8 tarjetas del hub (VISTAS §10). Es una lista literal a propósito: son
 * pantallas y endpoints concretos, no filas de una tabla.
 */
const REPORTS: readonly ReportDescriptor[] = [
  { key: "stock", permission: "reports:read" },
  { key: "sales", permission: "reports:read" },
  { key: "kardex", permission: "reports:read" },
  { key: "products", permission: "reports:read" },
  { key: "users", permission: "reports:read" },
  { key: "warehouses", permission: "reports:read" },
  // Herencias de F3: su pantalla ya existe y ya se lee con `inventory:read`.
  // Pedir `reports:read` para bajar en Excel lo que se está viendo en pantalla
  // sería una puerta nueva sobre un dato que la persona YA tiene enfrente.
  { key: "expiring", permission: "inventory:read" },
  { key: "inTransit", permission: "inventory:read" },
];

@Injectable()
export class ReportsService {
  /**
   * El catálogo COMPLETO, no filtrado por los permisos de quien pregunta.
   *
   * Filtrarlo acá sería tentador —«que el hub pinte solo lo suyo»— y estaría
   * mal: el permiso lo hace cumplir el guard de cada endpoint, y un catálogo
   * que cambia de forma según quién mira vuelve imposible distinguir «este
   * reporte no existe» de «no puedes verlo». El front decide qué tarjeta
   * dibuja con los permisos que ya tiene en el token.
   */
  catalog(): { reports: readonly ReportDescriptor[]; maxExportRows: number } {
    return { reports: REPORTS, maxExportRows: MAX_EXPORT_ROWS };
  }
}
