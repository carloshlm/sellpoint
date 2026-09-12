import { MODULE_KEYS, type ModuleKey } from "@sellpoint/shared";
import {
  ClipboardList,
  ConciergeBell,
  FlaskConical,
  Microscope,
  NotebookText,
  Receipt,
  ShoppingCart,
  Stethoscope,
  Tags,
  Ticket,
  Truck,
  UserRoundSearch,
} from "lucide-react";
import type * as React from "react";
import type { TenantBlock } from "@/lib/tenant/api";

type NavIcon = React.ComponentType<{
  className?: string;
  "aria-hidden"?: boolean | "true" | "false";
}>;

export interface ModuleNavLink {
  /** La ruta del web. Las rutas de un módulo llegan con su propio PR (Recepción: F9-RECEP-11/13). */
  to: string;
  labelKey: string;
  /** El PERMISO decide si el ROL puede; el módulo, si el negocio lo tiene. Los dos en AND. */
  permission: string;
  icon: NavIcon;
  /**
   * F9-PO-11: un enlace que además depende de un AJUSTE del negocio (las
   * órdenes de compra se encienden en Mi perfil). Ausente = siempre.
   */
  when?: (tenant: TenantBlock) => boolean;
}

export interface ModuleNavGroup {
  labelKey: string;
  icon: NavIcon;
  links: ModuleNavLink[];
}

/**
 * F9-MOD-08 — el grupo de menú de cada módulo avanzado, por MAPA y no por
 * `if` en el layout: agregar un módulo es agregar una entrada acá y sus
 * rutas, sin tocar `app-layout.tsx`. El grupo se OCULTA cuando el negocio no
 * tiene el módulo — sin candado, porque el candado abre el modal de planes y
 * el modal no vende módulos (se pactan uno a uno desde el backoffice).
 */
/**
 * Proveedores es un CATÁLOGO (Carlos, 2026-09-12): vive en el grupo Catálogos
 * del layout, junto a Almacenes, Productos y Servicios, y no dentro de Compras
 * ni de Gastos. Sigue dependiendo de que el negocio tenga alguno de los dos
 * módulos: sin compras ni gastos no hay a quién comprarle. Exportado para que
 * el layout lo pinte con el mismo icono y la misma etiqueta de siempre.
 */
export const SUPPLIERS_LINK: ModuleNavLink = {
  to: "/suppliers",
  labelKey: "common.layout.nav.suppliers",
  permission: "suppliers:read",
  icon: Truck,
};

/** Los módulos que le dan sentido a Proveedores: con cualquiera de los dos, se ve. */
export const SUPPLIERS_MODULES: readonly ModuleKey[] = ["purchases", "expenses"];

export const MODULE_NAV: Record<ModuleKey, ModuleNavGroup> = {
  reception: {
    labelKey: "common.layout.nav.modules.reception.group",
    icon: ConciergeBell,
    links: [
      {
        to: "/reception/customers",
        labelKey: "common.layout.nav.modules.reception.customers",
        permission: "reception:read",
        icon: ClipboardList,
      },
      {
        to: "/reception/turns",
        labelKey: "common.layout.nav.modules.reception.turns",
        permission: "reception:read",
        icon: Ticket,
      },
    ],
  },
  // F9-CLINIC-17 — los catálogos se leen con `:read`; atender exige
  // `:attend` (la recepcionista no abre expedientes).
  medical_clinic: {
    labelKey: "common.layout.nav.modules.medical_clinic.group",
    icon: Stethoscope,
    links: [
      {
        to: "/medical-clinic/lab-studies",
        labelKey: "common.layout.nav.modules.medical_clinic.labStudies",
        permission: "medical_clinic:read",
        icon: FlaskConical,
      },
      {
        to: "/medical-clinic/diagnostic-studies",
        labelKey: "common.layout.nav.modules.medical_clinic.diagnosticStudies",
        permission: "medical_clinic:read",
        icon: Microscope,
      },
      {
        to: "/medical-clinic/attend",
        labelKey: "common.layout.nav.modules.medical_clinic.attend",
        permission: "medical_clinic:attend",
        icon: UserRoundSearch,
      },
      // F9-CLINIC-WEB-28: leer expedientes exige `:attend`, igual que abrirlos.
      {
        to: "/medical-clinic/records",
        labelKey: "common.layout.nav.modules.medical_clinic.records",
        permission: "medical_clinic:attend",
        icon: NotebookText,
      },
    ],
  },
  // F9-PLANMOD-01 — Compras (desde Pro) y Gastos (desde Basic). Proveedores
  // vivió acá (F9-SUPPL-09) hasta el 2026-09-12: ahora es un catálogo más del
  // grupo Catálogos (`SUPPLIERS_LINK`).
  purchases: {
    labelKey: "common.layout.nav.modules.purchases.group",
    icon: ShoppingCart,
    links: [
      {
        to: "/purchases",
        labelKey: "common.layout.nav.modules.purchases.purchases",
        permission: "purchases:read",
        icon: ShoppingCart,
      },
      {
        to: "/purchase-orders",
        labelKey: "common.layout.nav.modules.purchases.orders",
        permission: "purchases:read",
        icon: ClipboardList,
        when: (tenant) => tenant.usesPurchaseOrders,
      },
    ],
  },
  // F9-EXP-14 — Gastos: el listado y las categorías.
  expenses: {
    labelKey: "common.layout.nav.modules.expenses.group",
    icon: Receipt,
    links: [
      {
        to: "/expenses",
        labelKey: "common.layout.nav.modules.expenses.expenses",
        permission: "expenses:read",
        icon: Receipt,
      },
      {
        to: "/expenses/categories",
        labelKey: "common.layout.nav.modules.expenses.categories",
        permission: "expenses:read",
        icon: Tags,
      },
    ],
  },
};

/** Las entradas en el orden del catálogo, para iterarlas en el layout. */
export const MODULE_NAV_ENTRIES: [ModuleKey, ModuleNavGroup][] = MODULE_KEYS.map((key) => [
  key,
  MODULE_NAV[key],
]);
