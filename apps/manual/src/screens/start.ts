import type { Page } from "playwright";
import { DEMO, NEWCOMER } from "../demo.js";
import { authColumn, card, type Screen } from "./kit.js";

/** Quita el foco del último control que se tocó: el anillo azul distrae en el papel. */
const blur = (page: Page) =>
  page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

/** Parte 1 — Primeros pasos. */
export const START: Screen[] = [
  // ── Capítulo 1 — Crear tu cuenta y el asistente de alta ────────────────
  {
    id: "sign-up",
    chapter: "01-start/01-create-account.md",
    as: "visitor",
    path: "/register",
    prepare: async (page) => {
      // Lo que escribiría Sofía Luna, sin presionar «Crear cuenta».
      await page.getByLabel("Nombre", { exact: true }).fill(NEWCOMER.firstName);
      await page.getByLabel("Apellido", { exact: true }).fill(NEWCOMER.lastName);
      await page.getByLabel("Email").fill(NEWCOMER.email);
      await page.getByLabel("Contraseña", { exact: true }).fill(NEWCOMER.password);
      await page.getByRole("button", { name: "Mostrar contraseña" }).click();
      await page.locator("#accept-terms").click();
      await page.locator("#accept-privacy").click();
      await blur(page);
    },
    target: authColumn,
  },
  {
    id: "wizard-business",
    chapter: "01-start/01-create-account.md",
    as: "newcomer",
    path: "/onboarding?step=1",
    // El paso 1 no cabe entero en una página: de «Paso 1 de 3» al RFC.
    target: (page) => [
      page.getByTestId("wizard-step-label"),
      page.getByText("Por ejemplo ABC010101AB1", { exact: true }),
    ],
  },
  {
    // La tarjeta del paso, sin el fondo vacío alrededor.
    id: "wizard-theme",
    chapter: "01-start/01-create-account.md",
    as: "newcomer",
    path: "/onboarding?step=3",
    target: (page) => [page.locator("[data-slot='card']")],
  },

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

  // ── Capítulo 3 — Conoce la pantalla ────────────────────────────────────
  {
    // La ventana entera, un poco más chica que la de siempre: en el papel
    // sale reducida y así el menú se alcanza a leer.
    id: "app-screen",
    chapter: "01-start/03-the-screen.md",
    as: "owner",
    path: "/dashboard",
    viewport: { width: 1024, height: 720 },
  },
  {
    // Un celular chico: el menú del cajero cabe entero y no sobra media pantalla en blanco.
    id: "menu-phone",
    chapter: "01-start/03-the-screen.md",
    as: "cashier",
    path: "/pos",
    viewport: { width: 375, height: 667 },
    prepare: async (page) => {
      await page.getByRole("button", { name: "Abrir o cerrar el menú" }).click();
    },
  },
  {
    id: "theme-card",
    chapter: "01-start/03-the-screen.md",
    as: "owner",
    path: "/profile",
    colorScheme: "dark",
    target: (page) => [card(page, "Tema")],
  },

  // ── Capítulo 4 — Mi perfil: tus datos ──────────────────────────────────
  {
    id: "profile-details",
    chapter: "01-start/04-my-profile.md",
    as: "cashier",
    path: "/profile",
    target: (page) => [card(page, "Tus datos")],
  },
  {
    id: "preferences",
    chapter: "01-start/04-my-profile.md",
    as: "cashier",
    path: "/profile",
    target: (page) => [card(page, "Preferencias")],
  },
];
