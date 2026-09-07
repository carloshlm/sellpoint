import { type NameFormat, resolveNameFormat } from "@sellpoint/shared";
import { useAuthStore } from "@/stores/auth.store";

/**
 * F1-NAME-08 — cuántas casillas de apellido pinta un formulario.
 *
 * Sale del país del NEGOCIO (`tenants.country`), no del idioma de la pantalla
 * ni del país de la persona: una clínica canadiense atiende pacientes
 * mexicanas, y el formato decide qué se PIDE, nunca qué se acepta.
 *
 * No es un hook con `useAuthStore(selector)` sino una lectura directa del
 * store porque se llama dentro del render de formularios que ya se suscriben
 * a la sesión por otros campos; suscribirse otra vez solo agregaría renders.
 * Mismo criterio que `customer-form.tsx`, que ya lee el país así para el
 * teléfono.
 */
export function nameFormatOf(): NameFormat {
  return resolveNameFormat(useAuthStore.getState().user?.tenant.country ?? null);
}

/**
 * La etiqueta del PRIMER apellido, por formato. Es un `Record` con las claves
 * escritas literales y no una interpolación (`common.name.lastName.${f}`) por
 * dos razones: un formato nuevo no compila hasta tener su etiqueta, y las
 * claves se pueden buscar con grep en el repo.
 *
 * El segundo apellido tiene una sola etiqueta (`common.name.secondLastName`)
 * porque solo lo pide `double`.
 */
export const LAST_NAME_LABEL_KEY: Record<NameFormat, string> = {
  single: "common.name.lastName.single",
  double: "common.name.lastName.double",
  compound: "common.name.lastName.compound",
};
