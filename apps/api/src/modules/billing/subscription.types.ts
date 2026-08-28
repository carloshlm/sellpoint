import { localCalendarDate, type SubscriptionBlock } from "@sellpoint/shared";
import type { Entitlements } from "./entitlements.service";

export type { SubscriptionBlock };

/** Días de calendario entre dos fechas ISO (`YYYY-MM-DD`), sin pasar por horas. */
function daysBetween(fromIso: string, toIso: string): number {
  const [fy, fm, fd] = fromIso.split("-").map(Number);
  const [ty, tm, td] = toIso.split("-").map(Number);
  const from = Date.UTC(fy ?? 1970, (fm ?? 1) - 1, fd ?? 1);
  const to = Date.UTC(ty ?? 1970, (tm ?? 1) - 1, td ?? 1);
  return Math.round((to - from) / 86_400_000);
}

/**
 * F7-WEB-01 — `Entitlements` (lo que el guard consume) → `SubscriptionBlock`
 * (lo que el front pinta). Patrón A1: UN mapper para los DOS emisores
 * (login y GET /me) — la divergencia de shapes entre emisores del store de
 * auth ya costó un discovery en F1 y no se repite.
 *
 * `daysLeft` se calcula AQUÍ, con la zona del tenant: días de CALENDARIO
 * del negocio, no bloques de 24 horas. Los instantes guardados son límite
 * abierto (el arranque del día siguiente al último día hábil), así que la
 * fecha legible del vencimiento es la del milisegundo anterior — el último
 * día hábil completo vale 0 días restantes, nunca un negativo.
 */
export function toSubscriptionBlock(
  entitlements: Entitlements,
  timeZone: string,
  now: Date = new Date(),
): SubscriptionBlock {
  const deadline =
    entitlements.status === "trialing"
      ? entitlements.trialEndsAt
      : entitlements.status === "past_due"
        ? entitlements.graceEndsAt
        : entitlements.status === "active"
          ? entitlements.dueAt
          : null;

  let daysLeft: number | null = null;
  if (deadline !== null) {
    const hoy = localCalendarDate(timeZone, now);
    const ultimoDiaHabil = localCalendarDate(timeZone, new Date(Date.parse(deadline) - 1));
    daysLeft = Math.max(0, daysBetween(hoy, ultimoDiaHabil));
  }

  // Un `active` cuyo vencimiento ya pasó: el barrido de las 3 AM todavía no
  // lo movió a `past_due`. El instante guardado es límite ABIERTO (el
  // arranque del día siguiente al último día hábil), así que alcanzarlo ES
  // haber vencido. `past_due` no se marca acá: ese ya tiene su propio aviso.
  const overdue =
    entitlements.status === "active" &&
    entitlements.dueAt !== null &&
    now.getTime() >= Date.parse(entitlements.dueAt);

  return {
    planCode: entitlements.planCode,
    planName: entitlements.planName,
    status: entitlements.status as SubscriptionBlock["status"],
    billingCycle: entitlements.billingCycle,
    trialEndsAt: entitlements.trialEndsAt,
    dueAt: entitlements.dueAt,
    graceEndsAt: entitlements.graceEndsAt,
    daysLeft,
    overdue,
    writeAccess: entitlements.writeAccess,
    stockControl: entitlements.stockControl,
    dailySalesLimit: entitlements.dailySalesLimit,
    features: entitlements.features,
  };
}
