import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Browser, type BrowserContext, chromium, type Page } from "playwright";
import { CASHIER, DEMO, http, NEWCOMER } from "./demo.js";
import { IMG_DIR } from "./paths.js";
import type { Actor, ApiSession } from "./screens/kit.js";
import { SCREENS, type Screen } from "./screens.js";
import { API_URL, WEB_URL } from "./stack.js";

/**
 * Toma todas las capturas del registro. La ventana es de escritorio y al
 * DOBLE de densidad: en el PDF se imprimen reducidas y así el texto sale
 * nítido. Siempre en español de México y con el tema claro, salvo lo que una
 * captura pida (`viewport`, `colorScheme`, `locale`).
 */
const CONTEXT = {
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 2,
  locale: "es-MX",
  timezoneId: "America/Mexico_City",
  colorScheme: "light" as const,
};

/**
 * La densidad a la que se convierte un PDF del API: la de las capturas, 96 ppp
 * de pantalla por 2. Como el PDF del manual pone cada imagen a la mitad de sus
 * píxeles, el ticket sale impreso a su tamaño real.
 */
const PDF_DPI = 96 * CONTEXT.deviceScaleFactor;

const PADDING = 16;

const API_ORIGIN = new URL(API_URL).origin;

/** Con qué cuenta entra cada quien, y a qué ruta llega al entrar. */
const ACCOUNTS: Record<
  Exclude<Actor, "visitor">,
  { email: string; password: string; landing: RegExp }
> = {
  owner: { email: DEMO.email, password: DEMO.password, landing: /\/dashboard/ },
  cashier: { email: CASHIER.email, password: CASHIER.password, landing: /\/dashboard/ },
  // No terminó el asistente de alta: el panel la manda a él.
  newcomer: { email: NEWCOMER.email, password: NEWCOMER.password, landing: /\/onboarding/ },
};

/**
 * La app arranca en inglés sin importar el idioma del navegador, y solo cambia
 * si la persona ya eligió uno (`sellpoint.locale`) o si la dirección trae
 * `?lang=`. Para el manual en español se deja esa elección hecha de antemano.
 */
async function newContext(browser: Browser): Promise<BrowserContext> {
  const context = await browser.newContext(CONTEXT);
  await context.addInitScript(() => {
    window.localStorage.setItem("sellpoint.locale", "es");
  });
  return context;
}

/** La sesión de una cuenta, entrando por la pantalla de acceso como cualquiera. */
async function signedInContext(
  browser: Browser,
  account: { email: string; password: string; landing: RegExp },
): Promise<BrowserContext> {
  const context = await newContext(browser);
  const page = await context.newPage();
  await page.goto(`${WEB_URL}/login`);
  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Contraseña", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL(account.landing);
  await page.close();
  return context;
}

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle");
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  // Un respiro para las transiciones de entrada (anillos de foco, menús).
  await page.waitForTimeout(300);
}

/**
 * Lo que la pestaña de ESTA captura ve distinto, sin escribir nada en el
 * servidor. El tema (del negocio) y el idioma (de la cuenta) llegan en
 * `GET /me`: se cambian en esa respuesta. `apiOverrides` reemplaza el cuerpo
 * de las lecturas que nombra. En los dos casos la petición real sí se hace,
 * y de ella se conservan el estado y los encabezados (los de CORS incluidos):
 * solo cambia lo que dice.
 */
async function pretend(page: Page, screen: Screen): Promise<void> {
  if (screen.colorScheme) await page.emulateMedia({ colorScheme: screen.colorScheme });
  if (screen.colorScheme || screen.locale) {
    await page.route(
      (url) => url.origin === API_ORIGIN && url.pathname === "/me",
      async (route) => {
        if (route.request().method() !== "GET") return route.fallback();
        const response = await route.fetch();
        const user = (await response.json()) as {
          locale?: string;
          tenant?: { theme?: string | null };
        };
        if (screen.colorScheme && user.tenant) user.tenant.theme = screen.colorScheme;
        if (screen.locale) user.locale = screen.locale;
        await route.fulfill({ response, json: user });
      },
    );
  }
  for (const [path, json] of Object.entries(screen.apiOverrides ?? {})) {
    await page.route(
      (url) => url.origin === API_ORIGIN && url.pathname === path,
      async (route) => {
        // Solo lecturas: una escritura no se simula, porque la de verdad
        // tendría que ocurrir antes de poder cambiar lo que responde.
        if (route.request().method() !== "GET") return route.fallback();
        await route.fulfill({ response: await route.fetch(), json });
      },
    );
  }
}

/** `?lang=` gana sobre lo que el navegador tenga guardado: así abre ya en ese idioma. */
function withLocale(path: string, locale?: string): string {
  if (locale === undefined) return path;
  const [route = "", hash] = path.split("#");
  const withLang = `${route}${route.includes("?") ? "&" : "?"}lang=${locale}`;
  return hash === undefined ? withLang : `${withLang}#${hash}`;
}

async function shoot(page: Page, screen: Screen): Promise<void> {
  const path = join(IMG_DIR, `${screen.id}.png`);
  const targets = screen.target?.(page);
  if (!targets) {
    await page.screenshot({ path });
    return;
  }
  // Se mide TODO con la página quieta: desplazarla por cada pieza movería
  // las cajas ya medidas. Si la unión no cabe en la ventana, la ventana se
  // alarga lo necesario (el recorte solo puede tomar lo que se ve).
  await targets[0]?.first().scrollIntoViewIfNeeded();
  const measure = () =>
    Promise.all(
      targets.map(async (locator) => {
        const box = await locator.first().boundingBox();
        if (!box) throw new Error(`La captura «${screen.id}» no encontró lo que debía recortar.`);
        return box;
      }),
    );
  let boxes = await measure();
  const viewport = page.viewportSize();
  const top0 = Math.min(...boxes.map((b) => b.y));
  const bottom0 = Math.max(...boxes.map((b) => b.y + b.height));
  if (viewport && (top0 < 0 || bottom0 + PADDING > viewport.height)) {
    await page.setViewportSize({
      width: viewport.width,
      height: Math.ceil(bottom0 - top0 + 2 * PADDING + 120),
    });
    await targets[0]?.first().scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    boxes = await measure();
  }
  const left = Math.max(0, Math.min(...boxes.map((b) => b.x)) - PADDING);
  const top = Math.max(0, Math.min(...boxes.map((b) => b.y)) - PADDING);
  const right = Math.max(...boxes.map((b) => b.x + b.width)) + PADDING;
  const bottom = Math.max(...boxes.map((b) => b.y + b.height)) + PADDING;
  await page.screenshot({
    path,
    clip: { x: left, y: top, width: right - left, height: bottom - top },
  });
}

/** Una pantalla del web: se abre, se prepara y se recorta. */
async function shootPage(context: BrowserContext, screen: Screen): Promise<void> {
  const page = await context.newPage();
  try {
    if (screen.viewport) await page.setViewportSize(screen.viewport);
    await pretend(page, screen);
    await page.goto(`${WEB_URL}${withLocale(screen.path, screen.locale)}`);
    await settle(page);
    await screen.prepare?.(page);
    await settle(page);
    await shoot(page, screen);
  } finally {
    await page.close();
  }
}

/**
 * La sesión del API de quien toma la captura: un token nuevo de la MISMA
 * sesión del navegador, renovado con su cookie. Entrar otra vez abriría una
 * sesión nueva, y se vería en «Sesiones activas».
 */
async function apiSession(
  context: BrowserContext,
  screen: Screen,
): Promise<ApiSession & { token: string }> {
  if (screen.as === "visitor") {
    throw new Error(`La captura «${screen.id}» pide un PDF del API, y sin sesión no hay cómo.`);
  }
  const renewed = await context.request.post(`${API_URL}/auth/refresh`);
  if (!renewed.ok()) {
    throw new Error(
      `La captura «${screen.id}» no pudo renovar la sesión de «${screen.as}»: ${renewed.status()} ${await renewed.text()}`,
    );
  }
  const { accessToken } = (await renewed.json()) as { accessToken: string };
  return {
    token: accessToken,
    get: <T>(path: string) => http<T>("GET", path, undefined, accessToken),
  };
}

let pdftoppmCommand: string | undefined;
/** `pdftoppm`, de poppler: convierte una página de PDF en PNG. */
function pdftoppm(): string {
  if (pdftoppmCommand !== undefined) return pdftoppmCommand;
  for (const candidate of ["pdftoppm", "/opt/homebrew/bin/pdftoppm", "/usr/local/bin/pdftoppm"]) {
    if (spawnSync(candidate, ["-v"]).status === 0) {
      pdftoppmCommand = candidate;
      return candidate;
    }
  }
  throw new Error(
    "Para convertir un PDF del API en imagen hace falta pdftoppm, de poppler. Instálalo con: brew install poppler",
  );
}

/**
 * Un PDF del API (el ticket): se pide con la sesión de quien toma la captura
 * y su PRIMERA página se convierte en `<id>.png`, junto a las demás.
 */
async function shootPdf(
  context: BrowserContext,
  screen: Screen,
  resolve: NonNullable<Screen["pdf"]>,
): Promise<void> {
  const api = await apiSession(context, screen);
  const path = await resolve(api);
  const response = await fetch(`${API_URL}${path}`, {
    headers: { Authorization: `Bearer ${api.token}` },
  });
  if (!response.ok) {
    throw new Error(
      `La captura «${screen.id}» pidió ${path} y el API respondió ${response.status}: ${await response.text()}`,
    );
  }
  const dir = mkdtempSync(join(tmpdir(), "manual-pdf-"));
  try {
    const pdf = join(dir, "page.pdf");
    writeFileSync(pdf, Buffer.from(await response.arrayBuffer()));
    // Solo la primera página (`-f 1 -l 1`), en un archivo sin número de página.
    const firstPage = ["-png", "-r", String(PDF_DPI), "-f", "1", "-l", "1", "-singlefile"];
    const converted = spawnSync(pdftoppm(), [...firstPage, pdf, join(IMG_DIR, screen.id)], {
      encoding: "utf8",
    });
    if (converted.status !== 0) {
      throw new Error(`pdftoppm no pudo convertir «${screen.id}»:\n${converted.stderr}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Toma las capturas del registro. Con `only`, solo las que cumplen, y sin
 * borrar las demás: es lo que usa `shoot.ts` mientras se escribe un capítulo.
 */
export async function captureAll(only?: (screen: Screen) => boolean): Promise<void> {
  if (!only) rmSync(IMG_DIR, { recursive: true, force: true });
  mkdirSync(IMG_DIR, { recursive: true });
  const screens = only ? SCREENS.filter(only) : SCREENS;
  const browser = await chromium.launch();
  try {
    // Cada cuenta entra la primera vez que una captura la necesita: con un
    // filtro de `shoot.ts`, solo entran las que hacen falta.
    const contexts = new Map<Actor, Promise<BrowserContext>>();
    const contextOf = (actor: Actor): Promise<BrowserContext> => {
      let context = contexts.get(actor);
      if (context === undefined) {
        context =
          actor === "visitor" ? newContext(browser) : signedInContext(browser, ACCOUNTS[actor]);
        contexts.set(actor, context);
      }
      return context;
    };
    console.log(`Tomando ${screens.length} capturas…`);
    for (const screen of screens) {
      const context = await contextOf(screen.as);
      if (screen.pdf) await shootPdf(context, screen, screen.pdf);
      else await shootPage(context, screen);
      console.log(`  · ${screen.id}`);
    }
  } finally {
    await browser.close();
  }
}
