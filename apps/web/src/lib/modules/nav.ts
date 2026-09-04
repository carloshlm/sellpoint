import { MODULE_KEYS, type ModuleKey } from "@sellpoint/shared";
import {
  ClipboardList,
  ConciergeBell,
  FlaskConical,
  Microscope,
  NotebookText,
  Stethoscope,
  Ticket,
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
};

/** Las entradas en el orden del catálogo, para iterarlas en el layout. */
export const MODULE_NAV_ENTRIES: [ModuleKey, ModuleNavGroup][] = MODULE_KEYS.map((key) => [
  key,
  MODULE_NAV[key],
]);
