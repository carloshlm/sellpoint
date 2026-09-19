// Los tres eventos que no nacen dentro de un componente con guion propio. Lo
// importa la plantilla base, una sola vez por página.
import { APP_REGISTER_URL } from "../config/links";
import { track } from "./track";

/** La sección desde la que se hizo clic: dice qué parte de la página convence. */
function sectionOf(element: Element): string {
  if (element.closest("[data-site-nav], [data-mobile-menu]")) return "nav";
  if (element.closest(".hero")) return "hero";
  return element.closest("section[id]")?.id ?? "footer";
}

document.addEventListener("click", (event) => {
  const link = (event.target as Element).closest<HTMLAnchorElement>("a[href]");
  if (!link) return;
  // La conversión principal: un clic en «Empieza gratis», esté donde esté.
  if (link.href === APP_REGISTER_URL) track("cta_click", { section: sectionOf(link) });
  // Muchos cambios de país o idioma = la sugerencia está adivinando mal.
  const switched = link.closest("[data-market-switcher]") && link.dataset.route !== undefined;
  if (switched || link.closest("[data-market-notice]")) {
    track("market_change", { section: sectionOf(link) });
  }
});

// Si las tarjetas resumidas alcanzan, o la gente necesita el detalle.
document.querySelector("[data-plans-compare]")?.addEventListener("toggle", (event) => {
  if ((event.currentTarget as HTMLDetailsElement).open) track("plans_expand", { section: "plans" });
});
