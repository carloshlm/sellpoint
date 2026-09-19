// F11-SITE-SEO-02. El sandbox NO se protege aquí sino en su vhost
// (`X-Robots-Tag: noindex`): este archivo es el mismo en todos lados.
import type { APIRoute } from "astro";
import { UNDER_CONSTRUCTION } from "../config/mode";
import { absoluteUrl } from "../config/seo";

export const GET: APIRoute = () =>
  // En construcción no se anuncia un sitemap de páginas que no existen. Se deja
  // pasar al robot para que LEA el `noindex` de la página.
  new Response(
    UNDER_CONSTRUCTION
      ? "User-agent: *\nAllow: /\n"
      : `User-agent: *\nAllow: /\n\nSitemap: ${absoluteUrl("/sitemap.xml")}\n`,
    {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    },
  );
