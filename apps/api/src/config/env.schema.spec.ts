import { validateEnv } from "./env.schema";

const validEnv = {
  NODE_ENV: "development",
  PORT: "3000",
  DATABASE_URL: "postgresql://sellpoint:sellpoint@localhost:5432/sellpoint_dev",
  REDIS_URL: "redis://localhost:6379",
  REFRESH_COOKIE_PATH: "/auth",
};

describe("validateEnv", () => {
  it("acepta un env válido y coerciona PORT a number", () => {
    const result = validateEnv(validEnv);

    expect(result.PORT).toBe(3000);
    expect(result.NODE_ENV).toBe("development");
    expect(result.DATABASE_URL).toBe(validEnv.DATABASE_URL);
    expect(result.REDIS_URL).toBe(validEnv.REDIS_URL);
  });

  it("aplica defaults: NODE_ENV=development y PORT=3000 cuando faltan", () => {
    const { NODE_ENV, PORT, ...rest } = validEnv;

    const result = validateEnv(rest);

    expect(result.NODE_ENV).toBe("development");
    expect(result.PORT).toBe(3000);
  });

  it("falla nombrando la variable cuando falta DATABASE_URL", () => {
    const { DATABASE_URL, ...rest } = validEnv;

    expect(() => validateEnv(rest)).toThrow(/DATABASE_URL/);
  });

  it("falla nombrando la variable cuando falta REDIS_URL", () => {
    const { REDIS_URL, ...rest } = validEnv;

    expect(() => validateEnv(rest)).toThrow(/REDIS_URL/);
  });

  it("rechaza NODE_ENV fuera del enum", () => {
    expect(() => validateEnv({ ...validEnv, NODE_ENV: "staging" })).toThrow(/NODE_ENV/);
  });

  it("rechaza DATABASE_URL que no sea URL", () => {
    expect(() => validateEnv({ ...validEnv, DATABASE_URL: "no-es-url" })).toThrow(/DATABASE_URL/);
  });

  it("rechaza PORT no numérico", () => {
    expect(() => validateEnv({ ...validEnv, PORT: "abc" })).toThrow(/PORT/);
  });

  it("parsea CORS_ORIGINS separado por comas a array", () => {
    const result = validateEnv({
      ...validEnv,
      CORS_ORIGINS: "http://localhost:5173, https://app.sellpoint.mx",
    });

    expect(result.CORS_ORIGINS).toEqual(["http://localhost:5173", "https://app.sellpoint.mx"]);
  });

  it("aplica default de CORS_ORIGINS cuando falta", () => {
    const result = validateEnv(validEnv);

    expect(result.CORS_ORIGINS).toEqual(["http://localhost:5173"]);
  });

  it("rechaza CORS_ORIGINS con entradas que no son URL", () => {
    expect(() => validateEnv({ ...validEnv, CORS_ORIGINS: "http://ok.com,no-es-url" })).toThrow(
      /CORS_ORIGINS/,
    );
  });

  it("ignora variables extra del entorno sin fallar", () => {
    const result = validateEnv({ ...validEnv, HOME: "/Users/algo", SHELL: "/bin/zsh" });

    expect(result).not.toHaveProperty("HOME");
  });

  describe("f1-auth: JWT/MAIL/COOKIE/THROTTLE", () => {
    it("aplica defaults de JWT/MAIL/COOKIE/THROTTLE cuando faltan", () => {
      const result = validateEnv(validEnv);

      expect(result.JWT_ISSUER).toBe("sellpoint-api");
      expect(result.JWT_AUDIENCE).toBe("sellpoint-app");
      expect(result.JWT_ACCESS_TTL_MIN).toBe(15);
      expect(result.MAIL_DRIVER).toBe("console");
      expect(result.COOKIE_DOMAIN).toBe("");
      expect(result.REFRESH_TOKEN_TTL_DAYS).toBe(7);
      expect(result.REFRESH_FAMILY_MAX_DAYS).toBe(30);
      expect(result.THROTTLE_ENABLED).toBe(true);
      expect(result.TRUST_PROXY_HOPS).toBe(1);
      // 300 y no 100 (2026-08-31): límite anti-bot con margen humano — ver env.schema.ts.
      expect(result.THROTTLE_GLOBAL_LIMIT).toBe(300);
      expect(result.THROTTLE_GLOBAL_TTL_SEC).toBe(60);
      expect(result.THROTTLE_AUTH_IP_LIMIT).toBe(5);
      expect(result.THROTTLE_AUTH_IP_TTL_SEC).toBe(900);
      expect(result.THROTTLE_AUTH_EMAIL_LIMIT).toBe(10);
      expect(result.THROTTLE_AUTH_EMAIL_TTL_SEC).toBe(3600);
    });

    it("falla nombrando la variable cuando falta REFRESH_COOKIE_PATH (obligatoria, sin default)", () => {
      const { REFRESH_COOKIE_PATH, ...rest } = validEnv;

      expect(() => validateEnv(rest)).toThrow(/REFRESH_COOKIE_PATH/);
    });

    it("parsea THROTTLE_ENABLED=false a boolean", () => {
      const result = validateEnv({ ...validEnv, THROTTLE_ENABLED: "false" });

      expect(result.THROTTLE_ENABLED).toBe(false);
    });

    it("rechaza COOKIE_DOMAIN no vacío (cookie host-only, D6 vps-multidominio)", () => {
      expect(() => validateEnv({ ...validEnv, COOKIE_DOMAIN: ".laradoc.com" })).toThrow(
        /COOKIE_DOMAIN/,
      );
    });

    it("acepta COOKIE_DOMAIN vacío explícito", () => {
      const result = validateEnv({ ...validEnv, COOKIE_DOMAIN: "" });

      expect(result.COOKIE_DOMAIN).toBe("");
    });

    it("rechaza MAIL_DRIVER=resend sin RESEND_API_KEY ni MAIL_FROM", () => {
      expect(() => validateEnv({ ...validEnv, MAIL_DRIVER: "resend" })).toThrow(/MAIL_DRIVER/);
    });

    it("acepta MAIL_DRIVER=resend con RESEND_API_KEY y MAIL_FROM", () => {
      const result = validateEnv({
        ...validEnv,
        MAIL_DRIVER: "resend",
        RESEND_API_KEY: "re_xxx",
        MAIL_FROM: "no-reply@system.laradoc.com",
      });

      expect(result.MAIL_DRIVER).toBe("resend");
    });

    it("rechaza MAIL_DRIVER=console cuando NODE_ENV=production", () => {
      expect(() =>
        validateEnv({ ...validEnv, NODE_ENV: "production", MAIL_DRIVER: "console" }),
      ).toThrow(/MAIL_DRIVER/);
    });

    it("rechaza MAIL_DRIVER=noop cuando NODE_ENV=production", () => {
      expect(() =>
        validateEnv({ ...validEnv, NODE_ENV: "production", MAIL_DRIVER: "noop" }),
      ).toThrow(/MAIL_DRIVER/);
    });

    it("acepta MAIL_DRIVER=resend en NODE_ENV=production con key y from", () => {
      const result = validateEnv({
        ...validEnv,
        NODE_ENV: "production",
        MAIL_DRIVER: "resend",
        RESEND_API_KEY: "re_xxx",
        MAIL_FROM: "no-reply@system.laradoc.com",
        // F7-ADMIN-01: producción exige la whitelist del backoffice.
        BILLING_ADMIN_EMAILS: "carlos@sellpointy.com",
      });

      expect(result.MAIL_DRIVER).toBe("resend");
    });
  });

  describe("F7-ADMIN-01: la whitelist del backoffice", () => {
    it("en producción es obligatoria: sin ella el backoffice no tiene dueño", () => {
      expect(() =>
        validateEnv({
          ...validEnv,
          NODE_ENV: "production",
          MAIL_DRIVER: "resend",
          RESEND_API_KEY: "re_xxx",
          MAIL_FROM: "no-reply@sellpointy.com",
        }),
      ).toThrow(/BILLING_ADMIN_EMAILS/);
    });

    it("en dev puede faltar (default vacío = backoffice cerrado)", () => {
      const result = validateEnv(validEnv);
      expect(result.BILLING_ADMIN_EMAILS).toBe("");
    });
  });
});
