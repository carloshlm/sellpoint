import type { Locator, Page } from "playwright";
import { card, type Screen } from "./kit.js";

const USERS = "07-team/32-users.md";
const ROLES = "07-team/33-roles.md";
const MY_PLAN = "07-team/34-my-plan.md";

/**
 * El renglón de Luis, el cajero, en la tabla de usuarios. Por su texto y no
 * por su rol: con el menú abierto, la tabla queda oculta para la accesibilidad.
 */
const cashierRow = (page: Page) => page.locator("tr", { hasText: "Luis Ramírez" });

/**
 * Sube lo que se va a recortar al borde de arriba de la ventana. Hace falta
 * cuando el recorte es más largo que lo que queda visible: cada pieza se mide
 * donde está en la ventana, y si una obliga a desplazar la página, las que ya
 * se midieron quedan en otro lugar.
 */
const scrollToTop = (locator: Locator) =>
  locator
    .first()
    // Con un respiro arriba: el recorte deja 16 px de margen alrededor.
    .evaluate((element) => window.scrollBy(0, element.getBoundingClientRect().top - 24));

/** La tarjeta con la lista de roles (la que tiene el botón «Nuevo rol»). */
const roleList = (page: Page) =>
  page
    .locator("[data-slot='card']")
    .filter({ has: page.getByRole("button", { name: "Nuevo rol", exact: true }) });

/** Parte 7 — Tu equipo y tu cuenta, y los apéndices. */
export const TEAM: Screen[] = [
  // ── Capítulo 32 — Usuarios: invitar y asignarles sucursal ──────────────
  {
    id: "users-list",
    chapter: USERS,
    as: "owner",
    path: "/system/users",
    target: (page) => [
      page.getByTestId("system-users-title"),
      page.getByRole("button", { name: "Nuevo usuario" }),
      page.getByRole("table"),
    ],
  },
  {
    id: "user-new",
    chapter: USERS,
    as: "owner",
    path: "/system/users",
    // Se llena como ejemplo, sin presionar «Crear usuario».
    prepare: async (page) => {
      await page.getByRole("button", { name: "Nuevo usuario" }).click();
      await page.getByLabel("Email").fill("marta.lopez@example.com");
      await page.getByLabel("Nombre", { exact: true }).fill("Marta");
      await page.getByLabel("Apellido paterno").fill("López");
      await page.getByLabel("Sucursal asignada").selectOption({ label: "Sucursal Norte" });
      // El rol de fábrica del cajero, con su nombre en español: la dueña de
      // la demo se registra en español.
      await page.getByRole("checkbox", { name: "Cajero" }).click();
    },
    target: (page) => [card(page, "Nuevo usuario")],
  },
  {
    id: "user-actions",
    chapter: USERS,
    as: "owner",
    path: "/system/users",
    prepare: async (page) => {
      await cashierRow(page).getByRole("button").click();
      await page.getByRole("menu").waitFor();
    },
    target: (page) => [page.locator("table"), page.getByRole("menu")],
  },
  {
    id: "user-store-scope",
    chapter: USERS,
    as: "owner",
    path: "/system/users",
    prepare: async (page) => {
      await cashierRow(page).getByRole("button").click();
      await page.getByRole("menuitem", { name: "Editar" }).click();
      await page.getByText("Alcance por sucursal", { exact: true }).waitFor();
      await scrollToTop(page.getByText("Sucursal asignada", { exact: true }));
    },
    // De la sucursal asignada al aviso del alcance: lo que toca a las sucursales.
    target: (page) => [
      page.getByText("Sucursal asignada", { exact: true }),
      // El desplegable marca el ancho del formulario.
      page.getByLabel("Sucursal asignada"),
      page.getByText(/^Sin sucursales marcadas/),
    ],
  },

  // ── Capítulo 33 — Roles: los de fábrica y los personalizados ───────────
  {
    id: "roles-seller",
    chapter: ROLES,
    as: "owner",
    path: "/system/roles",
    prepare: async (page) => {
      await roleList(page).getByText("Cajero", { exact: true }).click();
      await page.getByText("Ver historial de ventas", { exact: true }).waitFor();
      await scrollToTop(roleList(page));
      // El ratón se queda donde hizo clic y, tras desplazar, resalta otro rol.
      await page.mouse.move(0, 0);
    },
    // La lista y el principio de los permisos, hasta el grupo del punto de
    // venta. El campo del nombre marca el ancho de la tarjeta de permisos.
    target: (page) => [
      roleList(page),
      page.getByLabel("Nombre del rol"),
      page.getByText("Ver historial de ventas", { exact: true }),
    ],
  },
  {
    id: "role-new",
    chapter: ROLES,
    as: "owner",
    path: "/system/roles",
    // Se escribe el nombre, sin presionar «Crear rol».
    prepare: async (page) => {
      await page.getByRole("button", { name: "Nuevo rol", exact: true }).click();
      await page.getByLabel("Nombre del rol").fill("Cajero con anulaciones");
    },
    target: (page) => [
      roleList(page),
      page
        .locator("[data-slot='card']")
        .filter({ has: page.getByRole("button", { name: "Crear rol" }) }),
    ],
  },

  // ── Capítulo 34 — Mi plan ───────────────────────────────────────────────
  {
    id: "my-plan",
    chapter: MY_PLAN,
    as: "owner",
    path: "/settings/billing",
    target: (page) => [page.getByTestId("my-plan"), page.getByTestId("my-modules")],
  },
  {
    id: "payment-detail",
    chapter: MY_PLAN,
    as: "owner",
    path: "/settings/billing",
    prepare: async (page) => {
      await page.getByRole("button", { name: /^Ver pago del/ }).click();
      await page.getByText("Detalle del pago", { exact: true }).waitFor();
    },
    target: (page) => [card(page, "Historial de pagos")],
  },
  {
    id: "plans-modal",
    chapter: MY_PLAN,
    as: "owner",
    path: "/settings/billing",
    prepare: async (page) => {
      await page.getByRole("button", { name: "Ver planes" }).click();
      await page.getByRole("dialog").getByText("Exportar reportes").first().waitFor();
    },
    // El título y la cruz marcan el ancho; abajo, hasta «Exportar reportes»
    // de Plus: precios, límites y el principio de cada lista.
    target: (page) => {
      const dialog = page.getByRole("dialog");
      return [
        dialog.getByText("Elige el plan de tu negocio", { exact: true }),
        dialog.getByRole("button", { name: "Cerrar" }),
        dialog.getByText("Exportar reportes", { exact: true }).nth(2),
      ];
    },
  },
  {
    id: "plan-contact",
    chapter: MY_PLAN,
    as: "owner",
    // Como llega quien presionó «Me interesa» en el plan Pro: el mensaje ya
    // viene escrito. No se envía.
    path: "/settings/billing?interes=pro",
    target: (page) => [page.getByTestId("plan-contact")],
  },
];
