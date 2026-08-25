import { Injectable } from "@nestjs/common";
import { exportWithLimit } from "../../common/spreadsheet/export-guard";
import type { SpreadsheetFormat } from "../../common/spreadsheet/spreadsheet";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import type { UserScope } from "../../infrastructure/warehouse-scope/request-warehouse-scope";
import type { AuthUser } from "../auth/types/auth-user";
import { ImportService } from "../products/import.service";

/**
 * F5-CAT — los tres exports DIRECTOS: usuarios, almacenes y catálogo.
 *
 * ── Por qué existen si los listados ya existen ──────────────────────────
 *
 * Porque el PERMISO es otro. `GET /users` pide `users:manage` y la plantilla
 * de catálogo pide `products:manage` — los dos son permisos de EDICIÓN. Un
 * Viewer que solo puede leer se quedaba sin poder bajar su propio catálogo ni
 * la lista de su gente. Exportar es LEER: mismo criterio que «reimprimir es
 * leer» de F4-UI-03.
 *
 * Y por eso mismo no tienen pantalla propia: una tabla en Reportes duplicaría
 * los listados de Sistema, Almacenes y Catálogo. La tarjeta baja el Excel.
 */
/**
 * El estado del usuario tiene TRES valores, no dos: `invited` es quien todavía
 * no aceptó la invitación, y colapsarlo a «Inactivo» borraría justo el dato
 * que alguien busca cuando pregunta «¿por qué esta persona no entra?».
 */
const ESTADOS: Record<string, string> = {
  invited: "Invitado",
  active: "Activo",
  suspended: "Suspendido",
};

@Injectable()
export class CatalogExportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly imports: ImportService,
  ) {}

  /**
   * F5-CAT-01 — la gente del tenant.
   *
   * **Sin campos sensibles, y la lista es explícita**: nombre, correo, roles,
   * almacenes y estado. Nada de hashes ni de tokens — un Excel se reenvía por
   * correo sin pensarlo dos veces, así que lo que no puede salir del sistema
   * no entra al archivo. Se eligen las columnas de a una en vez de volcar la
   * fila entera justamente para que agregar un campo sensible al modelo no lo
   * filtre acá sin que nadie lo note.
   */
  async users(user: AuthUser, format: SpreadsheetFormat) {
    return exportWithLimit({
      count: () =>
        this.prisma.withTenantContext(user.tenantId, (tx) =>
          tx.user.count({ where: { tenantId: user.tenantId } }),
        ),
      rows: async () => {
        const usuarios = await this.prisma.withTenantContext(user.tenantId, (tx) =>
          tx.user.findMany({
            where: { tenantId: user.tenantId },
            select: {
              firstName: true,
              lastNamePaternal: true,
              lastNameMaternal: true,
              email: true,
              status: true,
              roles: { select: { role: { select: { name: true } } } },
              warehouseScopes: { select: { warehouse: { select: { name: true } } } },
            },
            orderBy: { createdAt: "asc" },
          }),
        );

        return usuarios.map((u) => [
          [u.firstName, u.lastNamePaternal, u.lastNameMaternal].filter(Boolean).join(" "),
          u.email,
          u.roles.map((r) => r.role.name).join(", "),
          // Sin alcance = todos los almacenes. La celda vacía se leería como
          // «ninguno», que es lo contrario.
          u.warehouseScopes.length === 0
            ? "Todos"
            : u.warehouseScopes.map((s) => s.warehouse.name).join(", "),
          ESTADOS[u.status] ?? u.status,
        ]);
      },
      header: ["Nombre", "Correo", "Roles", "Almacenes", "Estado"],
      format,
      sheetName: "Usuarios",
      filenameBase: "usuarios",
    });
  }

  /**
   * F5-CAT-02 — los almacenes del ALCANCE.
   *
   * Los desactivados se exportan MARCADOS y no se omiten: un almacén inactivo
   * con stock adentro es justo lo que alguien necesita encontrar cuando algo
   * no cuadra.
   */
  async warehouses(user: AuthUser, scope: UserScope, format: SpreadsheetFormat) {
    const where = {
      tenantId: user.tenantId,
      // Lista vacía → `in: []`, que no devuelve nada. Omitir la clave sería
      // «todos», justo lo contrario de un alcance vacío.
      ...(scope.warehouseIds === "all" ? {} : { id: { in: scope.warehouseIds } }),
    };

    return exportWithLimit({
      count: () =>
        this.prisma.withTenantContext(user.tenantId, (tx) => tx.warehouse.count({ where })),
      rows: async () => {
        const almacenes = await this.prisma.withTenantContext(user.tenantId, (tx) =>
          tx.warehouse.findMany({
            where,
            select: {
              name: true,
              address: true,
              isActive: true,
              // Cuántos productos tienen saldo ahí. `_count` lo resuelve
              // Postgres: contar en JavaScript traería las filas enteras solo
              // para tirarlas.
              _count: { select: { stock: { where: { quantity: { gt: 0 } } } } },
            },
            orderBy: { name: "asc" },
          }),
        );

        return almacenes.map((w) => [
          w.name,
          w.address ?? "",
          w.isActive ? "Activo" : "Inactivo",
          String(w._count.stock),
        ]);
      },
      header: ["Nombre", "Dirección", "Estado", "Productos con stock"],
      format,
      sheetName: "Almacenes",
      filenameBase: "almacenes",
    });
  }

  /**
   * F5-CAT-03 — el catálogo completo, campos dinámicos incluidos.
   *
   * Reusa `catalogRows` de la importación para que las columnas no puedan
   * divergir de las de la plantilla: lo que se exporta tiene que poder
   * reimportarse.
   *
   * Lo que NO reusa es la fila de EJEMPLO que la plantilla inventa cuando el
   * catálogo está vacío. Ahí los propósitos se separan: la plantilla enseña un
   * formato, el reporte informa lo que hay. Un «Paracetamol 500mg» en un
   * reporte diría que existe un producto que nadie dio de alta.
   */
  async products(user: AuthUser, format: SpreadsheetFormat) {
    const catalogo = await this.imports.catalogRows(user);

    return exportWithLimit({
      count: async () => catalogo.rows.length,
      rows: async () => catalogo.rows,
      header: catalogo.header,
      format,
      sheetName: "Catálogo",
      filenameBase: "catalogo",
    });
  }
}
