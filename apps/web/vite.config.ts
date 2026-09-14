import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    tsconfigPaths(),
    tanstackRouter({ target: "react", autoCodeSplitting: true }),
    react(),
    tailwindcss(),
  ],
  build: {
    /*
     * Sin `<link rel="modulepreload">` (Carlos, 2026-09-14).
     *
     * Chrome avisaba en consola «A preload for … is found, but is not used
     * because it is a cross-world service worker resource mismatch», seguido de
     * «preloaded but not used within a few seconds». Con el service worker
     * controlando la página, la PRECARGA y la carga real del mismo archivo se
     * resolvían por caminos distintos: tras un deploy los chunks nuevos no están
     * en la caché, la precarga salía por la red, `sw.js` los guardaba de fondo,
     * y cuando llegaba el import real ya salía de Cache Storage. Chromium
     * descarta la precarga, así que el archivo se pedía dos veces.
     *
     * Por qué desactivarlas y no cambiar la estrategia de `sw.js`: es la única
     * salida cuyo efecto es seguro por construcción — sin precargas no hay nada
     * que pueda chocar—. Cambiar el service worker no se pudo verificar: el
     * Chromium de las pruebas no reproduce el aviso.
     *
     * Costo, medido en su tamaño real: sin precarga, el navegador descubre las
     * dependencias al leer el archivo de entrada, una vuelta de red más. Solo
     * pesa en la PRIMERA carga tras cada deploy (hashes nuevos); después todo
     * sale de la caché del service worker igual que antes.
     */
    modulePreload: false,
  },
});
