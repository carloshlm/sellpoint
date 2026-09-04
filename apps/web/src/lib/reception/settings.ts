import {
  DEFAULT_RECEPTION_SETTINGS,
  pluralizeLabel,
  type ReceptionMenuItem,
  type ReceptionSettings,
} from "@sellpoint/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { ApiError } from "@/lib/api";
import { usePlan } from "@/lib/billing/use-plan";
import {
  getReceptionSettings,
  type UpdateReceptionSettingsInput,
  updateReceptionSettings,
} from "./settings-api";

export const RECEPTION_SETTINGS_KEY = ["reception", "settings"] as const;

/**
 * F9-RECEP-18 — la configuración de Recepción en el web.
 *
 * Se pide UNA vez y se cachea largo: la lee el menú en cada pantalla y las
 * cuatro rutas del módulo, y cambia una vez al año. Sin módulo (`enabled`
 * en falso) no se pide. Si la red falla, el módulo sigue usable con los
 * defaults de fábrica — una palabra propia que no cargó no es motivo para
 * dejar a la recepcionista sin turnos.
 */
export function useReceptionSettings(enabled: boolean) {
  return useQuery<ReceptionSettings, ApiError>({
    queryKey: RECEPTION_SETTINGS_KEY,
    queryFn: getReceptionSettings,
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function useUpdateReceptionSettings() {
  const queryClient = useQueryClient();
  return useMutation<ReceptionSettings, ApiError, UpdateReceptionSettingsInput>({
    // Envuelta a propósito: react-query pasa un segundo argumento (su
    // contexto) que el cliente HTTP no tiene por qué ver.
    mutationFn: (input) => updateReceptionSettings(input),
    onSuccess: (data) => {
      // Se escribe directo en la caché: el menú y las pantallas repintan al
      // instante con la palabra nueva, sin esperar un refetch.
      queryClient.setQueryData(RECEPTION_SETTINGS_KEY, data);
    },
  });
}

export interface ReceptionEntity {
  /** «Paciente» — Capitalizada, para encabezados. */
  entity: string;
  /** «paciente» — para mitad de frase. */
  entityLower: string;
  /** «Pacientes». */
  entities: string;
  /** «pacientes». */
  entitiesLower: string;
  /**
   * Las cuatro cadenas juntas, listas para `t(key, entity.vars)`: i18next
   * pide un diccionario plano y este objeto no lleva nada más.
   */
  vars: Record<string, string>;
  settings: ReceptionSettings;
  isPending: boolean;
}

/**
 * La palabra con la que ESTE negocio llama a su cliente, lista para
 * interpolar en los textos del módulo: `t("reception.customers.title", entity)`.
 *
 * Sin palabra propia sale la de fábrica del idioma (`reception.entity.*`),
 * así que los textos se escriben UNA vez con `{{entity}}` / `{{entityLower}}`
 * y valen para los dos casos. El plural se deriva con la misma regla que
 * usa el API.
 */
export function useReceptionEntity(): ReceptionEntity {
  const { t, i18n } = useTranslation();
  const { hasModule } = usePlan();
  const { data, isPending } = useReceptionSettings(hasModule("reception"));
  const idioma = i18n.language.startsWith("en") ? "en" : "es";
  const settings = data ?? DEFAULT_RECEPTION_SETTINGS;
  const propia = settings.customerLabel;
  const entity = propia ?? t("reception.entity.singular");
  const entities = propia === null ? t("reception.entity.plural") : pluralizeLabel(propia, idioma);
  const vars = {
    entity,
    entityLower: entity.toLocaleLowerCase(idioma),
    entities,
    entitiesLower: entities.toLocaleLowerCase(idioma),
  };
  return { ...vars, vars, settings, isPending: data === undefined && isPending };
}

/** La ruta del web de cada entrada del menú que el negocio puede apagar. */
const RUTA_DE: Record<ReceptionMenuItem, string> = {
  customers: "/reception/customers",
  turns: "/reception/turns",
};

/** Las rutas de Recepción que la configuración esconde del menú. */
export function hiddenReceptionRoutes(settings: ReceptionSettings): ReadonlySet<string> {
  const ocultas = new Set<string>();
  if (!settings.showCustomers) ocultas.add(RUTA_DE.customers);
  if (!settings.showTurns) ocultas.add(RUTA_DE.turns);
  return ocultas;
}

export function isReceptionItemVisible(
  settings: ReceptionSettings,
  item: ReceptionMenuItem,
): boolean {
  return item === "customers" ? settings.showCustomers : settings.showTurns;
}
