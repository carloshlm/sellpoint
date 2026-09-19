// F11-SITE-PLANS-05 — de dónde sale el precio el día que se prenda.
//
// De `GET /billing/plans?country=`, AL CONSTRUIR el sitio y no en el navegador:
// el precio queda en el HTML (Google lo lee, la página abre al instante) y el
// sitio no depende de que el API esté arriba para pintarse. Es el mismo
// endpoint y la misma `resolveMarket` del cobro: nadie ve un precio y paga otro.
//
// Si el API no responde al construir, LA CONSTRUCCIÓN FALLA: publicar sin
// precios por accidente es peor que no publicar. Y un cambio de precio pide
// reconstruir el sitio.
//
// Con `showPrices` apagado nada de esto corre: ni se llama al API ni hace falta
// `SITE_API_URL`. Hoy está apagado en los tres mercados.
import { PUBLISHED_PLANS, type PublishedPlan } from "@sellpoint/shared";
import { MARKETS, type MarketId } from "./markets";

export type PlanPrices = Record<PublishedPlan, { monthly: number; yearly: number }>;

/** Lo que este módulo necesita de cada plan de la respuesta del API. */
interface ApiPlan {
  code: string;
  price: { currency: string; monthly: string; yearly: string } | null;
}

export function pricesFromPlans(plans: ApiPlan[], currency: string): PlanPrices {
  const entries = PUBLISHED_PLANS.map((code) => {
    const price = plans.find((plan) => plan.code === code)?.price;
    // Una tarjeta sin precio junto a dos que lo tienen no se publica.
    if (!price)
      throw new Error(`El plan «${code}» llegó sin precio: no se publican precios a medias.`);
    // Ver pesos y pagar dólares es el peor error posible de esta página.
    if (price.currency !== currency) {
      throw new Error(
        `El plan «${code}» llegó en ${price.currency}, y este mercado cobra en ${currency}.`,
      );
    }
    return [code, { monthly: Number(price.monthly), yearly: Number(price.yearly) }] as const;
  });
  return Object.fromEntries(entries) as PlanPrices;
}

interface LoadOptions {
  showPrices?: boolean;
  apiUrl?: string | undefined;
  fetchImpl?: typeof fetch;
}

/** Los precios de un mercado, o `null` si ese mercado los tiene apagados. */
export async function loadMarketPrices(
  market: MarketId,
  options: LoadOptions = {},
): Promise<PlanPrices | null> {
  const { country, currency } = MARKETS[market];
  const showPrices = options.showPrices ?? MARKETS[market].showPrices;
  if (!showPrices) return null;

  const apiUrl = "apiUrl" in options ? options.apiUrl : import.meta.env.SITE_API_URL;
  if (!apiUrl) {
    throw new Error(
      `Los precios de «${market}» están prendidos pero falta SITE_API_URL: de ahí se leen al construir.`,
    );
  }
  const url = `${apiUrl.replace(/\/$/, "")}/billing/plans?country=${country}`;
  const response = await (options.fetchImpl ?? fetch)(url);
  if (!response.ok) {
    throw new Error(`No se pudieron leer los precios (${url} respondió ${response.status}).`);
  }
  return pricesFromPlans((await response.json()) as ApiPlan[], currency);
}
