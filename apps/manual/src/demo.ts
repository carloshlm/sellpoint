import { randomUUID } from "node:crypto";
import { API_URL, PLATFORM_ADMIN_EMAIL, type Stack } from "./stack.js";

/**
 * El negocio de DEMOSTRACIÓN del manual: datos inventados, nunca de un cliente.
 * Se crea por el mismo camino que un cliente real —el registro, el correo de
 * verificación, el asistente de alta—, así que lo que sale en las capturas es
 * exactamente lo que ve quien se da de alta. Los correos son de `example.com`,
 * el dominio reservado para ejemplos. Las contraseñas solo viven en la base del
 * manual, que se borra en cada corrida.
 */
export const DEMO = {
  business: "Abarrotes La Esquina",
  firstName: "Ana",
  lastName: "Pérez",
  email: "ana.perez@example.com",
  password: "Esquina-Demo-2026",
  /** El código que autoriza un descuento en caja (Mi perfil › Descuentos). */
  discountCode: "4821",
} as const;

/** El cajero: entra por invitación, como entraría el de un cliente. */
export const CASHIER = {
  firstName: "Luis",
  lastName: "Ramírez",
  email: "luis.ramirez@example.com",
  password: "Cajero-Demo-2026",
} as const;

/** El administrador de SellPointy que registra el pago del plan desde el backoffice. */
const BACKOFFICE = {
  business: "SellPointy",
  firstName: "Soporte",
  lastName: "SellPointy",
  email: PLATFORM_ADMIN_EMAIL,
  password: "Backoffice-Demo-2026",
} as const;

export async function http<T>(
  method: string,
  path: string,
  body?: unknown,
  token?: string,
  headers: Record<string, string> = {},
): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${method} ${path} respondió ${response.status}: ${text}`);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

/**
 * El token del ÚLTIMO correo que el API mandó a esa dirección, leído de su
 * consola: su buzón en local. Viaja después de `#` (`…/verify-email#token=…`),
 * así no queda en los registros de ningún servidor.
 */
export async function mailToken(stack: Stack, email: string): Promise<string> {
  const pattern = new RegExp(
    `to=${email.replace(/[.]/g, "\\.")}[\\s\\S]*?[?&#]token=([\\w-]+)`,
    "g",
  );
  for (let i = 0; i < 40; i += 1) {
    const last = [...stack.apiLog().matchAll(pattern)].at(-1)?.[1];
    if (last) return last;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `No llegó el correo de ${email} a la consola del API. Lo último que escribió:\n${stack
      .apiLog()
      .slice(-2500)}`,
  );
}

export async function login(email: string, password: string): Promise<string> {
  const { accessToken } = await http<{ accessToken: string }>("POST", "/auth/login", {
    email,
    password,
  });
  return accessToken;
}

/** Una venta necesita su propia llave: la caja no cobra dos veces lo mismo. */
export const idempotency = () => ({ "Idempotency-Key": randomUUID() });

/** Hoy en la Ciudad de México, `YYYY-MM-DD`, o `offsetDays` días antes o después. */
export function today(offsetDays = 0): string {
  const date = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(date);
}

async function register(
  stack: Stack,
  account: {
    business: string;
    firstName: string;
    lastName: string;
    email: string;
    password: string;
  },
): Promise<{ tenantId: string; token: string }> {
  const { tenantId } = await http<{ tenantId: string }>("POST", "/auth/register-tenant", {
    tenantName: account.business,
    email: account.email,
    password: account.password,
    firstName: account.firstName,
    lastName: account.lastName,
    locale: "es",
    acceptTerms: true,
    acceptPrivacy: true,
  });
  await http("POST", "/auth/verify-email", { token: await mailToken(stack, account.email) });
  return { tenantId, token: await login(account.email, account.password) };
}

export interface Demo {
  tenantId: string;
  /** La sesión de la dueña, para sembrar por el API. */
  token: string;
}

export async function createDemo(stack: Stack): Promise<Demo> {
  console.log(`Creando el negocio de demostración «${DEMO.business}»…`);
  const { tenantId, token } = await register(stack, DEMO);

  // Lo que llena el asistente de alta, y terminarlo: con eso el negocio
  // entra directo a su panel, como un cliente que ya se dio de alta.
  await http(
    "PATCH",
    "/tenants/me",
    {
      name: DEMO.business,
      legalName: `${DEMO.firstName} ${DEMO.lastName}`,
      country: "MX",
      currency: "MXN",
      timezone: "America/Mexico_City",
      // RFC de persona física con el formato válido; inventado.
      taxId: "PEAA850315AB3",
      address: "Av. Juárez 123",
      addressLine2: "Centro",
      city: "Ciudad de México",
      region: "CMX",
      postalCode: "06000",
      phone: "+525555012345",
      monthlySalesGoal: 60000,
      discountCode: DEMO.discountCode,
      discountMaxPercent: 15,
    },
    token,
  );
  await http("POST", "/tenants/me/complete-onboarding", undefined, token);
  await http(
    "PUT",
    "/tenants/me/ticket-settings",
    {
      logo: { kind: "preset", preset: "store" },
      footerMessage: "¡Gracias por tu compra! Vuelve pronto.",
    },
    token,
  );
  console.log(`  · ${DEMO.email} entra a su panel`);
  return { tenantId, token };
}

/**
 * El negocio ya PAGÓ su plan Plus: lo registra un administrador de SellPointy
 * desde el backoffice, como pasa con un cliente real. Sin esto el negocio
 * seguiría en prueba gratis y cada captura llevaría el aviso de los 14 días.
 * El administrador necesita la marca en su usuario y su correo en
 * `BILLING_ADMIN_EMAILS`, que el API del manual ya trae.
 */
export async function payPlusPlan(stack: Stack, demo: Demo): Promise<void> {
  await register(stack, BACKOFFICE);
  stack.sql(
    `UPDATE users SET is_platform_admin = true WHERE lower(email) = '${BACKOFFICE.email}';`,
  );
  // Se entra de nuevo: la sesión de antes no sabía que era administrador.
  const admin = await login(BACKOFFICE.email, BACKOFFICE.password);
  const plans = await http<{ code: string; prices: { country: string; priceMonthly: string }[] }[]>(
    "GET",
    "/admin/billing/plans",
    undefined,
    admin,
  );
  const price = plans
    .find((plan) => plan.code === "plus")
    ?.prices.find((p) => p.country === "MX")?.priceMonthly;
  if (!price) throw new Error("No encontré el precio mensual de Plus en México.");
  await http(
    "POST",
    `/admin/billing/tenants/${demo.tenantId}/payments`,
    {
      billingCycle: "monthly",
      method: "transfer",
      paidAt: today(),
      planCode: "plus",
      amountReceived: Number(price).toFixed(2),
    },
    admin,
  );
  console.log(`  · pagó Plus mensual ($${Number(price).toFixed(2)} MXN)`);
}
