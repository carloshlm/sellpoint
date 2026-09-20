// F11-SITE-GEO-02 y GEO-04 — la elección de la persona y cuándo mostrar el aviso.
//
// Lógica pura, sin navegador: los guiones de la página solo le pasan lo que
// leyeron. Así se prueba en `test/choice.test.ts` sin montar un DOM.
import { isRoute, type Route } from "../config/markets";

/** La clave en `localStorage`. Guarda una ruta de la matriz, nada más. */
export const CHOICE_KEY = "route";

type ReadableStorage = Pick<Storage, "getItem">;
type WritableStorage = Pick<Storage, "setItem">;

/**
 * `localStorage`, si se deja usar. Puede no existir o TRONAR con solo nombrarlo
 * (modo privado de algunos navegadores, datos del sitio bloqueados): en ese
 * caso el sitio funciona igual, solo que no recuerda.
 */
export function getStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** La ruta que la persona eligió, o `null` si no eligió o lo guardado ya no vale. */
export function readChoice(storage: ReadableStorage | null): Route | null {
  try {
    const value = storage?.getItem(CHOICE_KEY);
    return isRoute(value) ? value : null;
  } catch {
    return null;
  }
}

export function saveChoice(storage: WritableStorage | null, route: Route): void {
  try {
    storage?.setItem(CHOICE_KEY, route);
  } catch {
    // Sin espacio o sin permiso: la elección vale para esta visita y ya.
  }
}

/**
 * A qué versión invitar desde el aviso de la raíz, o `null` si no hay aviso.
 *
 * La elección guardada MANDA sobre la sugerencia: quien eligió México no
 * vuelve a ver «¿Estás en Canadá?» aunque su zona horaria lo diga. Y quien
 * eligió Canadá y vuelve por `sellpointy.com` ve el aviso hacia SU versión:
 * la raíz nunca redirige sola, pero tampoco le pierde la pista.
 */
export function decideNotice(input: {
  current: Route;
  saved: Route | null;
  suggested: Route;
}): Route | null {
  const target = input.saved ?? input.suggested;
  return target === input.current ? null : target;
}

/**
 * GEO-05 — a qué versión MANDAR sola a la raíz, o `null` para quedarse.
 *
 * Carlos lo pidió el 2026-09-19 con la IP («si es de Canadá, la versión de
 * Canadá»). La IP no está disponible —el sitio es HTML estático servido por
 * el `nginx-edge`, que no trae geolocalización, y Cloudflare está en modo
 * «solo DNS», así que no llega el país; un servicio de terceros está
 * descartado—. Manda la ZONA HORARIA, que para México, Estados Unidos y
 * Canadá acierta lo mismo y no depende de nadie.
 *
 * Tres frenos, y los tres importan:
 * 1. **`saved`**: quien eligió a mano NUNCA se mueve. Va de viaje o usa VPN.
 * 2. **`confident`**: solo cuando la zona horaria IDENTIFICA el mercado. Si
 *    la sugerencia salió del idioma del navegador es una corazonada, y con
 *    una corazonada no se mueve a nadie de página. Esto es además lo que
 *    protege el SEO: el robot de Google renderiza en UTC —zona neutra—, así
 *    que para él la raíz se queda quieta y sigue siendo la `x-default`.
 * 3. **`suggested === current`**: nadie se manda a donde ya está.
 *
 * La elección NO se guarda al mandar: la persona no eligió nada. Si vuelve
 * por la raíz se vuelve a decidir, y el selector del menú sigue a un clic.
 */
export function decideAutoRoute(input: {
  current: Route;
  saved: Route | null;
  suggested: Route;
  /** ¿La zona horaria, por sí sola, dice en qué mercado está? */
  confident: boolean;
}): Route | null {
  if (input.saved !== null || !input.confident) {
    return null;
  }
  return input.suggested === input.current ? null : input.suggested;
}

export interface SectionPosition {
  id: string;
  /** Distancia del borde superior de la sección al de la ventana, en px. */
  top: number;
}

/**
 * La sección que se está leyendo: la última que ya cruzó la línea de lectura
 * (`threshold` px desde arriba). Cambiar de idioma lleva a esa misma sección
 * en la otra versión — las anclas son las mismas en todos los idiomas.
 */
export function currentSection(sections: SectionPosition[], threshold: number): string | null {
  let current: string | null = null;
  for (const section of sections) {
    if (section.top <= threshold) current = section.id;
  }
  return current;
}
