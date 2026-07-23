import { validateEnv } from "./env.schema";

const validEnv = {
  NODE_ENV: "development",
  PORT: "3000",
  DATABASE_URL: "postgresql://sellpoint:sellpoint@localhost:5432/sellpoint_dev",
  REDIS_URL: "redis://localhost:6379",
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
});
