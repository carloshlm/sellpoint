// F11-SITE-SEO-02. El sandbox NO se protege aquí sino en su vhost
// (`X-Robots-Tag: noindex`): este archivo es el mismo en todos lados.
import type { APIRoute } from "astro";
import { absoluteUrl } from "../config/seo";

export const GET: APIRoute = () =>
  new Response(`User-agent: *\nAllow: /\n\nSitemap: ${absoluteUrl("/sitemap.xml")}\n`, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
