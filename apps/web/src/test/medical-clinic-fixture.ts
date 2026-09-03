import type { MedicalRecord, RecordSection } from "@/lib/medical-clinic/api";
import type { AuthUser } from "@/stores/auth.store";
import { SUBSCRIPTION_PLUS } from "./subscription-fixture";

/** El usuario de pruebas del consultorio: módulo activo y los permisos que se pidan. */
export const clinicUser = (permissions: string[]): AuthUser => ({
  id: "u1",
  email: "ana@acme.mx",
  firstName: "Ana",
  lastNamePaternal: "Pérez",
  lastNameMaternal: null,
  locale: "es",
  permissions,
  subscription: { ...SUBSCRIPTION_PLUS, modules: ["medical_clinic"] },
  tenant: {
    id: "tenant-1",
    name: "Acme",
    legalName: null,
    taxId: null,
    phone: null,
    theme: null,
    address: null,
    timezone: "America/Mexico_City",
    currency: "MXN",
    templateChoice: null,
    country: "MX",
    onboarded: true,
    sellWithoutStock: false,
    usesLocations: false,
    monthlySalesGoal: null,
  },
});

/** Un expediente con TODAS las secciones pendientes; `secciones` sobreescribe las que se pidan. */
export function expediente(
  over: Partial<MedicalRecord> = {},
  secciones: Partial<Record<string, Record<string, unknown>>> = {},
): MedicalRecord {
  const base: MedicalRecord = {
    id: "r1",
    folio: "HCL-000010",
    status: "open",
    consultationDate: "2026-09-03",
    closedAt: null,
    turnNumber: 7,
    patient: {
      customerId: "c1",
      name: "Rosa Luna Ríos",
      birthDate: "1990-09-02",
      sex: null,
      age: 36,
    },
    doctor: { id: "u1", name: "Ana Pérez" },
    sections: [],
    orders: [],
    createdAt: "2026-09-03T18:00:00.000Z",
    ...over,
  };
  const guardadas: RecordSection[] = Object.entries(secciones).map(([key, data]) => ({
    key,
    group: "interrogation",
    order: 1,
    functional: true,
    status: "completed",
    data: data ?? {},
    updatedAt: "2026-09-03T18:10:00.000Z",
  }));
  return { ...base, sections: [...base.sections, ...guardadas] };
}
