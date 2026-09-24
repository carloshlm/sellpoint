import type { Locator, Page } from "playwright";

/**
 * Cómo se describe una captura del manual: qué ruta abrir, como quién, qué
 * hacer antes de tomarla y qué parte recortar. Si una pantalla cambia, se
 * corre el manual otra vez y la captura se renueva sola; nadie pega imágenes
 * a mano.
 *
 * Una captura MIRA, no modifica: `prepare` puede abrir un menú, escribir en un
 * campo o elegir un filtro, pero nunca guardar. Todas comparten el mismo
 * negocio de demostración y el orden en que se toman no debe importar.
 */
export interface Screen {
  /** Lo que cita el capítulo: `![…](screen:<id>)`. */
  id: string;
  /** El capítulo que la usa, relativo a `docs/manual/es/`. */
  chapter: string;
  /** `visitor`: sin sesión. `owner`: la dueña del negocio de demostración. */
  as: "visitor" | "owner";
  path: string;
  /** Lo que se hace antes de la captura: escribir, abrir un menú… */
  prepare?: (page: Page) => Promise<void>;
  /**
   * Qué recortar. Sin esto, la ventana entera. Con varios, el rectángulo que
   * los contiene a todos (un botón y el menú que abre, por ejemplo).
   */
  target?: (page: Page) => Locator[];
}

/** Las pantallas de acceso: el idioma, el logotipo, la tarjeta y el enlace de abajo, sin el fondo vacío. */
export const authColumn = (page: Page) => [page.locator("main > div").first()];

export const card = (page: Page, title: string) =>
  page.locator("[data-slot='card']").filter({ has: page.getByText(title, { exact: true }) });
