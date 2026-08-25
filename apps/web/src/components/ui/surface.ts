/**
 * La piel de las SUPERFICIES elevadas: tarjetas, listados, tablas.
 *
 * ── Por qué existe este archivo (Carlos, 2026-08-25) ────────────────────
 *
 * Los listados se pintaban directo sobre el fondo de la página y cada tabla
 * decidía su propio aspecto. Esta constante es la única definición de "esto
 * va sobre una tarjeta": la consumen el contenedor de `ui/table.tsx` y la
 * caja de `ScrollableTable`, así que todos los listados —productos,
 * servicios, entradas, historial, reportes— la heredan de un solo lugar.
 *
 * ── Pensada para el selector de TEMAS del wizard ────────────────────────
 *
 * Acá no hay UN color: hay TOKENS (`bg-card`, `border-border`,
 * `text-card-foreground`) que resuelven a las variables CSS de `index.css`,
 * donde cada tema —claro, oscuro, y los que el wizard agregue— define sus
 * valores. Cambiar de tema no toca esta constante ni ningún componente:
 * cambia las variables y toda superficie se re-pinta sola. Por eso acá está
 * PROHIBIDO un color literal (`bg-white`, `#fff`): un literal se ve idéntico
 * hoy y rompe el primer tema oscuro que lo herede.
 *
 * Es la misma piel que `ui/card.tsx` (el molde de «Mi perfil»), sin el
 * padding ni el layout: una tabla necesita llegar hasta sus bordes.
 */
export const SURFACE = "rounded-lg border border-border bg-card text-card-foreground shadow-sm";
