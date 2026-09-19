import { defineConfig, fontProviders } from "astro/config";

// El sitio público de sellpointy.com (F11-SITE). HTML ya armado: lo sirve
// `nginx-edge` como archivos, sin servidor de Node detrás. Por eso no hay
// adaptador, y `test/scaffold.test.ts` falla si alguien agrega uno.
export default defineConfig({
  site: "https://sellpointy.com",
  output: "static",
  // `/es-mx/` y no `/es-mx`: nginx sirve carpetas con su index.html, y una
  // sola forma de cada URL es lo que pide la canónica (F11-SITE-SEO-01).
  trailingSlash: "always",
  build: { format: "directory" },

  // La CSP del vhost autoriza UN solo guion en línea —el del tema, por su
  // hash— y el resto por `'self'`. Astro incrusta en la página los guiones
  // pequeños (el del menú, el de imprimir): con la CSP puesta, el navegador los
  // BLOQUEA y el menú del celular no abre. Con el límite en 0 todos salen como
  // archivo. `test/pages.test.ts` falla si vuelve a aparecer uno incrustado.
  vite: { build: { assetsInlineLimit: 0 } },

  // F11-SITE-BASE-03 — las tres familias de la guía (§3), servidas desde el
  // propio dominio. Los archivos salen de paquetes de npm (`@fontsource*`), no
  // de una descarga al construir: quedan fijados por el lockfile y el CI no
  // depende de que un CDN de fuentes esté arriba.
  //
  // Solo el subconjunto `latin`: cubre español, inglés y francés completos
  // (incluye œ y Œ). Astro genera además, para cada familia, un respaldo del
  // sistema con las métricas ajustadas, para que el texto no salte al cargar.
  fonts: [
    {
      // Variable con DOS ejes, peso y tamaño óptico. El eje óptico es lo que
      // afina el titular gigante del hero —el navegador lo aplica solo, según
      // el tamaño de letra— y es como se aprobó el prototipo. Cuesta 77 KB
      // contra 41 KB del archivo de un solo eje; es la única que se precarga.
      provider: fontProviders.local(),
      name: "Bricolage Grotesque",
      cssVariable: "--font-display",
      fallbacks: ["Arial Narrow", "system-ui", "sans-serif"],
      options: {
        variants: [
          {
            weight: "200 800",
            style: "normal",
            display: "swap",
            src: [
              "@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-opsz-normal.woff2",
            ],
          },
        ],
      },
    },
    {
      // Variable de un eje: un archivo de 30 KB cubre los tres pesos que usa
      // el sitio (400, 500 y 600) y pesa menos que tres archivos estáticos.
      provider: fontProviders.local(),
      name: "Instrument Sans",
      cssVariable: "--font-body",
      fallbacks: ["system-ui", "-apple-system", "Segoe UI", "sans-serif"],
      options: {
        variants: [
          {
            weight: "400 700",
            style: "normal",
            display: "swap",
            src: [
              "@fontsource-variable/instrument-sans/files/instrument-sans-latin-wght-normal.woff2",
            ],
          },
        ],
      },
    },
    {
      provider: fontProviders.local(),
      name: "JetBrains Mono",
      cssVariable: "--font-mono",
      fallbacks: ["ui-monospace", "Menlo", "monospace"],
      options: {
        variants: [
          {
            weight: 500,
            style: "normal",
            display: "swap",
            src: ["@fontsource/jetbrains-mono/files/jetbrains-mono-latin-500-normal.woff2"],
          },
        ],
      },
    },
  ],
});
