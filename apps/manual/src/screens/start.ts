import { DEMO } from "../demo.js";
import { authColumn, card, type Screen } from "./kit.js";

/** Parte 1 — Primeros pasos. */
export const START: Screen[] = [
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
