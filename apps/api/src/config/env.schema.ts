import { z } from "zod";

const booleanFromString = z
  .enum(["true", "false"])
  .default("true")
  .transform((value) => value === "true");

const baseEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.url(),
  REDIS_URL: z.url(),
  CORS_ORIGINS: z
    .string()
    .default("http://localhost:5173")
    .transform((value) =>
      value
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.url())),

  // --- JWT (f1-auth AD-4): kid derivado por thumbprint, resolución
  // BASE64 > PATH > throw vive en JwtKeyProvider, no acá. ---
  JWT_PRIVATE_KEY_BASE64: z.string().optional(),
  JWT_PUBLIC_KEY_BASE64: z.string().optional(),
  JWT_PRIVATE_KEY_PATH: z.string().optional(),
  JWT_PUBLIC_KEY_PATH: z.string().optional(),
  JWT_ISSUER: z.string().default("sellpoint-api"),
  JWT_AUDIENCE: z.string().default("sellpoint-app"),
  JWT_ACCESS_TTL_MIN: z.coerce.number().int().positive().default(15),

  // --- Mail (f1-auth AD-9) ---
  MAIL_DRIVER: z.enum(["console", "resend", "noop"]).default("console"),
  MAIL_FROM: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  APP_URL: z.url().default("http://localhost:5173"),

  // --- Cookie de refresh (f1-auth AD-5, contrato vinculante D6 vps-multidominio) ---
  COOKIE_DOMAIN: z.string().default(""),
  // Obligatoria, SIN default (R9 del design): un default que "funciona" en
  // dev es justo el tipo de var que alguien olvida setear en prod.
  REFRESH_COOKIE_PATH: z.string().min(1),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),
  REFRESH_FAMILY_MAX_DAYS: z.coerce.number().int().positive().default(30),

  // --- Throttling (f1-auth AD-7) ---
  THROTTLE_ENABLED: booleanFromString,
  TRUST_PROXY_HOPS: z.coerce.number().int().nonnegative().default(1),
  THROTTLE_GLOBAL_LIMIT: z.coerce.number().int().positive().default(100),
  THROTTLE_GLOBAL_TTL_SEC: z.coerce.number().int().positive().default(60),
  THROTTLE_AUTH_IP_LIMIT: z.coerce.number().int().positive().default(5),
  THROTTLE_AUTH_IP_TTL_SEC: z.coerce.number().int().positive().default(900),
  THROTTLE_AUTH_EMAIL_LIMIT: z.coerce.number().int().positive().default(10),
  THROTTLE_AUTH_EMAIL_TTL_SEC: z.coerce.number().int().positive().default(3600),
});

export const envSchema = baseEnvSchema.superRefine((config, ctx) => {
  if (config.COOKIE_DOMAIN !== "") {
    ctx.addIssue({
      code: "custom",
      path: ["COOKIE_DOMAIN"],
      message:
        "COOKIE_DOMAIN debe quedar vacío — cookie host-only, ver D6 de vps-multidominio. NUNCA Domain=.laradoc.com.",
    });
  }

  if (config.MAIL_DRIVER === "resend" && (!config.MAIL_FROM || !config.RESEND_API_KEY)) {
    ctx.addIssue({
      code: "custom",
      path: ["MAIL_DRIVER"],
      message: "MAIL_DRIVER=resend requiere MAIL_FROM y RESEND_API_KEY.",
    });
  }

  if (config.NODE_ENV === "production" && config.MAIL_DRIVER !== "resend") {
    ctx.addIssue({
      code: "custom",
      path: ["MAIL_DRIVER"],
      message: "MAIL_DRIVER=console/noop está prohibido en NODE_ENV=production (R8 del design).",
    });
  }
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const result = envSchema.safeParse(config);

  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Variables de entorno inválidas:\n${detail}`);
  }

  return result.data;
}
