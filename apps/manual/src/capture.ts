import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { type Browser, type BrowserContext, chromium, type Page } from "playwright";
import { DEMO } from "./demo.js";
import { IMG_DIR } from "./paths.js";
import { SCREENS, type Screen } from "./screens.js";
import { WEB_URL } from "./stack.js";

/**
 * Toma todas las capturas del registro. La ventana es de escritorio y al
 * DOBLE de densidad: en el PDF se imprimen reducidas y así el texto sale
 * nítido. Siempre en español de México, tema claro.
 */
const CONTEXT = {
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 2,
  locale: "es-MX",
  timezoneId: "America/Mexico_City",
  colorScheme: "light" as const,
};

const PADDING = 16;

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

/** La sesión de la dueña, entrando por la pantalla de acceso como cualquiera. */
async function ownerContext(browser: Browser): Promise<BrowserContext> {
  const context = await newContext(browser);
  const page = await context.newPage();
  await page.goto(`${WEB_URL}/login`);
  await page.getByLabel("Email").fill(DEMO.email);
  await page.getByLabel("Contraseña", { exact: true }).fill(DEMO.password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL(/\/dashboard/);
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
    const visitor = await newContext(browser);
    const owner = await ownerContext(browser);
    console.log(`Tomando ${screens.length} capturas…`);
    for (const screen of screens) {
      const page = await (screen.as === "owner" ? owner : visitor).newPage();
      try {
        await page.goto(`${WEB_URL}${screen.path}`);
        await settle(page);
        await screen.prepare?.(page);
        await settle(page);
        await shoot(page, screen);
        console.log(`  · ${screen.id}`);
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
}
