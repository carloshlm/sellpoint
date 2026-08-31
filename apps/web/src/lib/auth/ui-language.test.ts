import { createI18n } from "@/i18n";
import { type AuthUser, useAuthStore } from "@/stores/auth.store";
import { SUBSCRIPTION_PLUS } from "@/test/subscription-fixture";
import { installAccountLanguageSync } from "./ui-language";

/**
 * Contrapeso del arranque en inglés (decisión de Carlos, 2026-08-16): la
 * pantalla pública es inglés-first, pero apenas hay sesión manda el idioma
 * de la CUENTA. Sin esto, un cliente mexicano con `locale: "es"` en un
 * navegador nuevo entraría a un dashboard en inglés — que es exactamente la
 * regresión que el inglés-first introduce si nadie la compensa.
 */
const TENANT: AuthUser["tenant"] = {
  id: "t1",
  name: "Tienda",
  legalName: null,
  taxId: null,
  phone: null,
  theme: null,
  address: null,
  timezone: "America/Mexico_City",
  currency: "MXN",
  templateChoice: null,
  onboarded: true,
  sellWithoutStock: false,
  usesLocations: false,
  monthlySalesGoal: null,
  country: "MX",
};

function makeUser(locale: AuthUser["locale"]): AuthUser {
  return {
    id: "u1",
    email: "ana@tienda.mx",
    firstName: "Ana",
    lastNamePaternal: "Pérez",
    lastNameMaternal: null,
    locale,
    permissions: [],
    subscription: SUBSCRIPTION_PLUS,
    tenant: TENANT,
  };
}

describe("installAccountLanguageSync", () => {
  afterEach(() => {
    useAuthStore.setState({ accessToken: null, user: null });
    localStorage.clear();
  });

  it("al iniciar sesión, el idioma de la cuenta pisa el elegido antes del login", async () => {
    const i18n = createI18n({ withDetector: true });
    const unsubscribe = installAccountLanguageSync(i18n);
    expect(i18n.resolvedLanguage).toBe("en");

    useAuthStore.getState().setAuth("token", makeUser("es"));
    await vi.waitFor(() => expect(i18n.resolvedLanguage).toBe("es"));

    unsubscribe();
  });

  it("un cambio del store que no toca el locale no reescribe el idioma", async () => {
    const i18n = createI18n({ withDetector: true });
    const unsubscribe = installAccountLanguageSync(i18n);
    const changeLanguage = vi.spyOn(i18n, "changeLanguage");

    // Refresh de token y resync de permisos: pasan por el store sin que el
    // idioma de la cuenta cambie.
    useAuthStore.getState().setToken("token");
    useAuthStore.getState().setAuth("token", makeUser("en"));
    useAuthStore.getState().setUser({ ...makeUser("en"), permissions: ["users:manage"] });

    expect(changeLanguage).not.toHaveBeenCalled();

    unsubscribe();
  });
});
