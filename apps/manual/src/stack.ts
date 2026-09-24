import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { API_DIR, appVersion, CACHE_DIR, ROOT, WEB_DIR } from "./paths.js";

/**
 * Un SellPointy APARTE para el manual: su propia base (`sellpoint_manual`,
 * borrada y recreada en cada corrida), su propio API y su propio web, en
 * puertos que no chocan con los de desarrollo. Así las capturas salen siempre
 * iguales —sin ventas viejas ni datos de pruebas— y nunca tocan lo que Carlos
 * tenga abierto.
 *
 * El web va COMPILADO (`vite build` + `vite preview`), no en modo desarrollo:
 * el modo desarrollo pinta el botón de las herramientas de TanStack en la
 * esquina, y saldría en todas las capturas.
 */
export const API_URL = "http://localhost:3100";
export const WEB_URL = "http://localhost:5199";
const DATABASE = "sellpoint_manual";
const WEB_BUILD = join(CACHE_DIR, "web");

export interface Stack {
  /** Todo lo que el API escribió en su consola: ahí llegan los correos (`MAIL_DRIVER=console`). */
  apiLog(): string;
  down(): Promise<void>;
}

/**
 * Credenciales de DESARROLLO, las mismas del entorno de pruebas
 * (`apps/api/test/setup-env.js`), con la base cambiada. Se leen de ese archivo
 * en vez de copiarse aquí: si algún día cambian, el manual no se queda atrás.
 */
function databaseUrls(): { app: string; admin: string } {
  const setup = readFileSync(join(API_DIR, "test/setup-env.js"), "utf8");
  const app = setup.match(/"(postgresql:\/\/sellpoint_app:[^"]+)"/)?.[1];
  const admin = setup.match(/"(postgresql:\/\/sellpoint:[^"]+)"/)?.[1];
  if (!app || !admin) {
    throw new Error("No encontré las URLs de la base de pruebas en apps/api/test/setup-env.js.");
  }
  const swap = (value: string) => {
    const url = new URL(value);
    url.pathname = `/${DATABASE}`;
    return url.toString();
  };
  return { app: swap(app), admin: swap(admin) };
}

function prisma(args: string[], adminUrl: string, input?: string) {
  return spawnSync("pnpm", ["exec", "prisma", ...args], {
    cwd: API_DIR,
    env: { ...process.env, DATABASE_URL_ADMIN: adminUrl },
    input,
    encoding: "utf8",
  });
}

/** Borra y recrea `sellpoint_manual`, y le aplica todas las migraciones. */
function resetDatabase(adminUrl: string): void {
  // Cinturón: esto BORRA una base. Jamás una que no sea la del manual.
  if (new URL(adminUrl).pathname !== `/${DATABASE}`) {
    throw new Error(`Me negué a borrar ${new URL(adminUrl).pathname}: solo borro /${DATABASE}.`);
  }
  const maintenance = new URL(adminUrl);
  maintenance.pathname = "/postgres";
  // Dos llamadas y no una: `DROP DATABASE` no puede ir dentro de una
  // transacción, y varias sentencias en un solo envío corren como una.
  for (const sql of [
    `DROP DATABASE IF EXISTS "${DATABASE}" WITH (FORCE);`,
    `CREATE DATABASE "${DATABASE}";`,
  ]) {
    const r = prisma(["db", "execute", "--stdin"], maintenance.toString(), `${sql}\n`);
    if (r.status !== 0) throw new Error(`Falló «${sql}»:\n${r.stdout}\n${r.stderr}`);
  }
  const migrated = prisma(["migrate", "deploy"], adminUrl);
  if (migrated.status !== 0) {
    throw new Error(`Fallaron las migraciones:\n${migrated.stdout}\n${migrated.stderr}`);
  }
}

function run(label: string, command: string, args: string[], env: Record<string, string> = {}) {
  console.log(`  · ${label}`);
  const r = spawnSync(command, args, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  if (r.status !== 0) throw new Error(`Falló «${label}»:\n${r.stdout}\n${r.stderr}`);
}

async function responds(url: string): Promise<boolean> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(1500) });
    return true;
  } catch {
    return false;
  }
}

async function waitFor(url: string, child: ChildProcess, log: () => string, seconds = 90) {
  for (let i = 0; i < seconds * 2; i += 1) {
    if (child.exitCode !== null) {
      throw new Error(`El proceso terminó antes de responder en ${url}:\n${log().slice(-3000)}`);
    }
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (r.ok) return;
    } catch {
      // todavía no escucha
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Nadie respondió en ${url} tras ${seconds} s:\n${log().slice(-3000)}`);
}

function start(command: string, args: string[], cwd: string, env: Record<string, string>) {
  // `detached`: el proceso encabeza su propio grupo, y al terminar se mata el
  // grupo entero (así no queda un hijo vivo ocupando el puerto).
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  let text = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    text += chunk.toString();
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    text += chunk.toString();
  });
  return { child, log: () => text };
}

function stop(child: ChildProcess): Promise<void> {
  const pid = child.pid;
  if (child.exitCode !== null || pid === undefined) return Promise.resolve();
  return new Promise((resolve) => {
    child.once("exit", () => resolve());
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      resolve();
    }
    setTimeout(() => {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        // ya terminó
      }
      resolve();
    }, 5000).unref();
  });
}

export async function up(): Promise<Stack> {
  for (const url of [API_URL, WEB_URL]) {
    if (await responds(url)) {
      throw new Error(`Algo ya responde en ${url}. Apágalo antes de generar el manual.`);
    }
  }
  if (await responds("http://localhost:3000/health")) {
    console.log(
      "  ⚠ El API de desarrollo está encendido: compilar el API le quita sus traducciones. " +
        "Reinícialo cuando termine el manual.",
    );
  }

  const urls = databaseUrls();
  console.log("Preparando un SellPointy aparte para el manual…");
  console.log("  · base sellpoint_manual, desde cero");
  resetDatabase(urls.admin);
  run("compilando shared", "pnpm", ["--filter", "@sellpoint/shared", "build"]);
  run("compilando el API", "pnpm", ["--filter", "api", "build"]);
  run(
    "compilando el web",
    "pnpm",
    ["--filter", "web", "exec", "vite", "build", "--outDir", WEB_BUILD, "--emptyOutDir"],
    { VITE_API_URL: API_URL, VITE_APP_VERSION: appVersion() },
  );

  // Llaves de firma propias, de un solo uso: el API del manual no necesita
  // las de desarrollo, y así no se leen.
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const api = start("node", ["dist/main.js"], API_DIR, {
    NODE_ENV: "development",
    PORT: "3100",
    DATABASE_URL: urls.app,
    DATABASE_URL_ADMIN: urls.admin,
    // Base 3 de Redis: las claves del manual no se mezclan con las de desarrollo.
    REDIS_URL: "redis://localhost:6379/3",
    CORS_ORIGINS: WEB_URL,
    APP_URL: WEB_URL,
    MAIL_DRIVER: "console",
    THROTTLE_ENABLED: "false",
    BILLING_CRON_ENABLED: "false",
    JWT_PRIVATE_KEY_BASE64: Buffer.from(
      privateKey.export({ type: "pkcs8", format: "pem" }),
    ).toString("base64"),
    JWT_PUBLIC_KEY_BASE64: Buffer.from(publicKey.export({ type: "spki", format: "pem" })).toString(
      "base64",
    ),
  });
  console.log("  · encendiendo el API en :3100");
  try {
    await waitFor(`${API_URL}/health`, api.child, api.log);
  } catch (error) {
    await stop(api.child);
    throw error;
  }

  const web = start(
    join(WEB_DIR, "node_modules/.bin/vite"),
    ["preview", "--outDir", WEB_BUILD, "--port", "5199", "--strictPort", "--host", "localhost"],
    WEB_DIR,
    {},
  );
  console.log("  · encendiendo el web en :5199");
  try {
    await waitFor(`${WEB_URL}/login`, web.child, web.log);
  } catch (error) {
    await Promise.all([stop(api.child), stop(web.child)]);
    throw error;
  }

  return {
    apiLog: api.log,
    down: async () => {
      await Promise.all([stop(api.child), stop(web.child)]);
    },
  };
}
