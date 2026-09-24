import { API_URL, type Stack } from "./stack.js";

/**
 * El negocio de DEMOSTRACIÓN del manual: datos inventados, nunca de un cliente.
 * Se crea por el mismo camino que un cliente real —el registro, el correo de
 * verificación, el asistente de alta—, así que lo que sale en las capturas es
 * exactamente lo que ve quien se da de alta. El correo es de `example.com`,
 * el dominio reservado para ejemplos.
 */
export const DEMO = {
  business: "Abarrotes La Esquina",
  firstName: "Ana",
  lastName: "Pérez",
  email: "ana.perez@example.com",
  // Solo vive en la base del manual, que se borra en cada corrida.
  password: "Esquina-Demo-2026",
} as const;

async function http<T>(method: string, path: string, body?: unknown, token?: string): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${method} ${path} respondió ${response.status}: ${text}`);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

/** El enlace de verificación, leído de la consola del API: su buzón en local. */
async function verificationToken(stack: Stack, email: string): Promise<string> {
  // El token viaja después de `#` (`/verify-email#token=…`): así no queda en
  // los registros de ningún servidor.
  const pattern = new RegExp(`to=${email.replace(/[.]/g, "\\.")}[\\s\\S]*?[?&#]token=([\\w-]+)`);
  for (let i = 0; i < 40; i += 1) {
    const token = stack.apiLog().match(pattern)?.[1];
    if (token) return token;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `No llegó el correo de verificación de ${email} a la consola del API. Lo último que escribió:\n${stack
      .apiLog()
      .slice(-2500)}`,
  );
}

export async function createDemo(stack: Stack): Promise<void> {
  console.log(`Creando el negocio de demostración «${DEMO.business}»…`);
  await http("POST", "/auth/register-tenant", {
    tenantName: DEMO.business,
    email: DEMO.email,
    password: DEMO.password,
    firstName: DEMO.firstName,
    lastName: DEMO.lastName,
    locale: "es",
    acceptTerms: true,
    acceptPrivacy: true,
  });
  await http("POST", "/auth/verify-email", { token: await verificationToken(stack, DEMO.email) });
  const { accessToken } = await http<{ accessToken: string }>("POST", "/auth/login", {
    email: DEMO.email,
    password: DEMO.password,
  });

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
      address: "Av. Juárez 123",
      city: "Ciudad de México",
      postalCode: "06000",
    },
    accessToken,
  );
  await http("POST", "/tenants/me/complete-onboarding", undefined, accessToken);
  console.log(`  · ${DEMO.email} entra a su panel`);
}
