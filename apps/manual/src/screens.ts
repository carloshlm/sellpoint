import { INSIGHTS } from "./screens/insights.js";
import { INVENTORY } from "./screens/inventory.js";
import type { Screen } from "./screens/kit.js";
import { PURCHASING } from "./screens/purchasing.js";
import { SETUP } from "./screens/setup.js";
import { START } from "./screens/start.js";
import { TEAM } from "./screens/team.js";

export type { Screen } from "./screens/kit.js";

/**
 * EL REGISTRO DE PANTALLAS del manual: cada captura que cita un capítulo
 * —`![Texto](screen:id)`— vive en el archivo de su parte, dentro de
 * `screens/`. Aquí solo se juntan, en el orden del manual.
 */
export const SCREENS: Screen[] = [
  ...START,
  ...SETUP,
  ...INVENTORY,
  ...PURCHASING,
  ...INSIGHTS,
  ...TEAM,
];
