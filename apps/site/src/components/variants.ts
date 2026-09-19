// Las variantes de los componentes base, en un solo lugar: las usan los tipos de
// cada componente y `test/components.test.ts`.

/** `dot` es el principal (amarillo); `ghost` va sobre azul; `blue` sobre claro. */
export const BUTTON_VARIANTS = ["dot", "ghost", "blue"] as const;
export type ButtonVariant = (typeof BUTTON_VARIANTS)[number];

/**
 * Los cuatro estados del punto (guía §4). No son iconos: son el punto,
 * transformándose — Vende (`full`), Controla (`ring`), Compra (`half`) y
 * Decide (`sun`).
 */
export const DOT_MARK_VARIANTS = ["full", "ring", "half", "sun"] as const;
export type DotMarkVariant = (typeof DOT_MARK_VARIANTS)[number];
