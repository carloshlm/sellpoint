import { describe, expect, it, vi } from "vitest";
import { loadMarketPrices, pricesFromPlans } from "../src/config/prices";

// F11-SITE-PLANS-05 — de dónde sale el precio cuando se prenda: de
// `GET /billing/plans?country=`, AL CONSTRUIR. Mismo endpoint y misma
// `resolveMarket` que el cobro: nadie ve un precio y paga otro.

const plan = (code: string, monthly: string | null) => ({
  code,
  price:
    monthly === null ? null : { currency: "MXN", monthly, yearly: String(Number(monthly) * 10) },
});
const okResponse = (body: unknown) =>
  ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

describe("pricesFromPlans", () => {
  it("toma el precio de los tres planes publicados, como números", () => {
    const prices = pricesFromPlans(
      [plan("free", null), plan("basic", "199.00"), plan("pro", "349.00"), plan("plus", "499.00")],
      "MXN",
    );
    expect(prices).toEqual({
      basic: { monthly: 199, yearly: 1990 },
      pro: { monthly: 349, yearly: 3490 },
      plus: { monthly: 499, yearly: 4990 },
    });
  });

  it("truena si a un plan publicado le falta precio: no se publica una tarjeta a medias", () => {
    expect(() => pricesFromPlans([plan("basic", "199"), plan("pro", "349")], "MXN")).toThrow(
      /plus/,
    );
    expect(() =>
      pricesFromPlans([plan("basic", "199"), plan("pro", "349"), plan("plus", null)], "MXN"),
    ).toThrow(/plus/);
  });

  it("truena si la moneda no es la del mercado: ver pesos y pagar dólares es el peor error", () => {
    const plans = [plan("basic", "199"), plan("pro", "349"), plan("plus", "499")];
    expect(() => pricesFromPlans(plans, "USD")).toThrow(/MXN/);
  });
});

describe("loadMarketPrices", () => {
  it("con los precios apagados NO llama al API: el sitio se construye sin él", async () => {
    const fetchImpl = vi.fn();
    expect(
      await loadMarketPrices("mx", { showPrices: false, fetchImpl, apiUrl: "http://api" }),
    ).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("prendidos, pide los planes del PAÍS del mercado", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        okResponse([plan("basic", "199"), plan("pro", "349"), plan("plus", "499")]),
      );
    const prices = await loadMarketPrices("mx", {
      showPrices: true,
      fetchImpl,
      apiUrl: "http://api/",
    });
    expect(fetchImpl).toHaveBeenCalledWith("http://api/billing/plans?country=MX");
    expect(prices?.pro.monthly).toBe(349);
  });

  it("si el API no responde, la construcción FALLA: publicar sin precios por accidente es peor", async () => {
    const down = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(
      loadMarketPrices("mx", { showPrices: true, fetchImpl: down, apiUrl: "http://api" }),
    ).rejects.toThrow(/ECONNREFUSED|precios/);
    const broken = vi.fn().mockResolvedValue({ ok: false, status: 503 } as Response);
    await expect(
      loadMarketPrices("mx", { showPrices: true, fetchImpl: broken, apiUrl: "http://api" }),
    ).rejects.toThrow(/503/);
  });

  it("prendidos y sin URL del API, truena con un mensaje que dice qué falta", async () => {
    await expect(
      loadMarketPrices("mx", { showPrices: true, fetchImpl: vi.fn(), apiUrl: undefined }),
    ).rejects.toThrow(/SITE_API_URL/);
  });
});
