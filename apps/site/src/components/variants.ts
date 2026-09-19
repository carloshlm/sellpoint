// Las variantes de los componentes base, en un solo lugar: las usan los tipos de
// cada componente y `test/components.test.ts`.

/**
 * `dot` es el principal (amarillo); `ghost` va sobre azul; `blue` sobre claro;
 * `outline` —borde en tinta— es el de los planes que NO son el recomendado
 * (guía §11): así el amarillo sigue señalando una sola cosa.
 */
export const BUTTON_VARIANTS = ["dot", "ghost", "blue", "outline"] as const;
export type ButtonVariant = (typeof BUTTON_VARIANTS)[number];

/**
 * Los cuatro estados del punto (guía §4). No son iconos: son el punto,
 * transformándose — Vende (`full`), Controla (`ring`), Compra (`half`) y
 * Decide (`sun`).
 */
export const DOT_MARK_VARIANTS = ["full", "ring", "half", "sun"] as const;
export type DotMarkVariant = (typeof DOT_MARK_VARIANTS)[number];
