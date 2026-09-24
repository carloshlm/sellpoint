import type { Locator, Page } from "playwright";
import { DEMO } from "./demo.js";

/**
 * EL REGISTRO DE PANTALLAS del manual. Cada captura que cita un capítulo
 * —`![Texto](screen:id)`— vive aquí: qué ruta abrir, como quién, qué hacer
 * antes de tomarla y qué parte recortar. Si una pantalla cambia, se corre el
 * manual otra vez y la captura se renueva sola; nadie pega imágenes a mano.
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
const authColumn = (page: Page) => [page.locator("main > div").first()];

const card = (page: Page, title: string) =>
  page.locator("[data-slot='card']").filter({ has: page.getByText(title, { exact: true }) });

export const SCREENS: Screen[] = [
  // ── Capítulo 2 — Entrar, salir y tu contraseña ─────────────────────────
  {
    id: "sign-in",
    chapter: "01-start/02-sign-in.md",
    as: "visitor",
    path: "/login",
    target: authColumn,
  },
  {
    id: "sign-in-eye",
    chapter: "01-start/02-sign-in.md",
    as: "visitor",
    path: "/login",
    prepare: async (page) => {
      await page.getByLabel("Email").fill(DEMO.email);
      await page.getByLabel("Contraseña", { exact: true }).fill(DEMO.password);
      await page.getByRole("button", { name: "Mostrar contraseña" }).click();
    },
    target: (page) => [page.locator("form")],
  },
  {
    id: "forgot-password",
    chapter: "01-start/02-sign-in.md",
    as: "visitor",
    path: "/forgot-password",
    target: authColumn,
  },
  {
    id: "user-menu",
    chapter: "01-start/02-sign-in.md",
    as: "owner",
    path: "/dashboard",
    prepare: async (page) => {
      // El botón lleva el nombre de la persona, así que se busca por lo que hace.
      await page.locator("button[aria-haspopup='menu']").click();
      await page.getByRole("menu").waitFor();
    },
    target: (page) => [page.locator("button[aria-haspopup='menu']"), page.getByRole("menu")],
  },
  {
    id: "change-password",
    chapter: "01-start/02-sign-in.md",
    as: "owner",
    path: "/profile",
    target: (page) => [card(page, "Cambiar contraseña")],
  },
  {
    id: "active-sessions",
    chapter: "01-start/02-sign-in.md",
    as: "owner",
    path: "/profile",
    target: (page) => [card(page, "Sesiones activas")],
  },
];
