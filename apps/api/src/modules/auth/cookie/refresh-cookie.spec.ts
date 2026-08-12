import {
  buildClearedRefreshCookieOptions,
  buildRefreshCookieOptions,
  REFRESH_COOKIE_NAME,
} from "./refresh-cookie";

describe("refresh-cookie (f1-auth AD-5 — contrato host-only vinculante)", () => {
  it("nombre de la cookie es sp_refresh", () => {
    expect(REFRESH_COOKIE_NAME).toBe("sp_refresh");
  });

  it("buildRefreshCookieOptions NUNCA incluye la clave `domain` (ni siquiera vacía)", () => {
    const options = buildRefreshCookieOptions(
      { NODE_ENV: "production", REFRESH_COOKIE_PATH: "/api/auth" },
      7 * 24 * 60 * 60 * 1000,
    );

    expect(options).not.toHaveProperty("domain");
    expect(Object.keys(options)).not.toContain("domain");
  });

  it("prod: secure=true, sameSite=strict, path=REFRESH_COOKIE_PATH, httpOnly=true", () => {
    const options = buildRefreshCookieOptions(
      { NODE_ENV: "production", REFRESH_COOKIE_PATH: "/api/auth" },
      1000,
    );

    expect(options).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      path: "/api/auth",
      maxAge: 1000,
    });
  });

  it("dev: secure=false (Safari rechaza Secure sobre http://localhost)", () => {
    const options = buildRefreshCookieOptions(
      { NODE_ENV: "development", REFRESH_COOKIE_PATH: "/auth" },
      1000,
    );

    expect(options.secure).toBe(false);
  });

  it("buildClearedRefreshCookieOptions: Max-Age=0 y sin `domain`", () => {
    const options = buildClearedRefreshCookieOptions({
      NODE_ENV: "production",
      REFRESH_COOKIE_PATH: "/api/auth",
    });

    expect(options.maxAge).toBe(0);
    expect(options).not.toHaveProperty("domain");
  });
});
