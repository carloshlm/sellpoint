import { fullName } from "@sellpoint/shared";
import type { Customer } from "./api";

/**
 * El texto con el que el buscador del listado encuentra a UN cliente recién
 * guardado (Carlos, 2026-09-08): correo antes que teléfono, y el nombre
 * completo solo cuando no hay ninguno de los dos. El correo y el teléfono son
 * más precisos que el nombre (dos «Rosa Luna» son normales; dos correos iguales
 * casi nunca), y el API busca por `contains` en los cinco campos, así que
 * cualquiera de los tres da con la persona.
 */
export function customerSearchKey(customer: Customer): string {
  return customer.email ?? customer.phone ?? fullName(customer);
}
