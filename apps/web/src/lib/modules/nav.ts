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
/** F9-SUPPL-09 — el enlace compartido por Compras y Gastos (uno solo: se deduplica por `to`). */
const SUPPLIERS_LINK: ModuleNavLink = {
  to: "/suppliers",
  labelKey: "common.layout.nav.suppliers",
  permission: "suppliers:read",
  icon: Truck,
};

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
  // F9-PLANMOD-01 — Compras (desde Pro) y Gastos (desde Basic). Sus rutas
  // propias llegan con F9-PURCH-10 y F9-EXP-14; mientras, el único enlace es
  // Proveedores (F9-SUPPL-09), el catálogo CORE que los dos comparten: va en
  // los dos grupos con la MISMA clave i18n y `useModuleNav` lo deduplica por
  // ruta, así que se ve una vez, bajo el primer grupo que el negocio tenga.
  purchases: {
    labelKey: "common.layout.nav.modules.purchases.group",
    icon: ShoppingCart,
    links: [SUPPLIERS_LINK],
  },
  // F9-EXP-14 — Gastos ya tiene sus rutas: el listado, las categorías y el
  // catálogo compartido de proveedores.
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
      SUPPLIERS_LINK,
    ],
  },
};

/** Las entradas en el orden del catálogo, para iterarlas en el layout. */
export const MODULE_NAV_ENTRIES: [ModuleKey, ModuleNavGroup][] = MODULE_KEYS.map((key) => [
  key,
  MODULE_NAV[key],
]);
