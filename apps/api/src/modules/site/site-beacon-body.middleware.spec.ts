import { Readable } from "node:stream";
import type { NextFunction, Request, Response } from "express";
import { SITE_BEACON_MAX_BYTES, SiteBeaconBodyMiddleware } from "./site-beacon-body.middleware";

/**
 * F11-SITE-SEO-06 — que `navigator.sendBeacon` pueda mandar `text/plain`.
 *
 * ── Por qué existe este middleware ──────────────────────────────────────
 * Un beacon con `Blob({type:"application/json"})` dispara **preflight CORS**,
 * y el preflight es una petición APARTE que el navegador puede no alcanzar a
 * completar cuando la página se está cerrando — que es justo cuando se manda
 * el último evento. Con `text/plain` el beacon es una petición SIMPLE, sin
 * preflight, y nada se pierde al salir de la página.
 *
 * El precio es este archivo: el parser de JSON de Express no toca
 * `text/plain`, así que alguien tiene que leer el cuerpo y parsearlo. Son
 * treinta líneas, acotadas a UNA ruta.
 */
function pedir(body: string, contentType: string): { req: Request; next: NextFunction } {
  const req = Readable.from([body]) as unknown as Request;
  req.headers = { "content-type": contentType };
  return { req, next: jest.fn() };
}

describe("SiteBeaconBodyMiddleware (F11-SITE-SEO-06)", () => {
  const middleware = new SiteBeaconBodyMiddleware();
  const res = {} as Response;

  it("un text/plain con JSON adentro queda en req.body como objeto", (done) => {
    const { req } = pedir('{"event":"cta_click","market":"mx","locale":"es"}', "text/plain");

    middleware.use(req, res, () => {
      expect(req.body).toEqual({ event: "cta_click", market: "mx", locale: "es" });
      done();
    });
  });

  it("acepta el charset que agrega el navegador", (done) => {
    const { req } = pedir('{"event":"form_open"}', "text/plain;charset=UTF-8");

    middleware.use(req, res, () => {
      expect(req.body).toEqual({ event: "form_open" });
      done();
    });
  });

  it("un application/json lo deja pasar intacto: ya lo parseó Express", (done) => {
    const { req } = pedir("{}", "application/json");
    req.body = { event: "form_submit" };

    middleware.use(req, res, () => {
      expect(req.body).toEqual({ event: "form_submit" });
      done();
    });
  });

  /** Lo que no es JSON no revienta: el servicio lo descartará con su 202. */
  it("un text/plain que no es JSON deja el cuerpo indefinido, sin lanzar", (done) => {
    const { req } = pedir("esto no es json", "text/plain");

    middleware.use(req, res, () => {
      expect(req.body).toBeUndefined();
      done();
    });
  });

  /** El parser global de JSON no cubre esta ruta: el tope se pone acá. */
  it("un cuerpo enorme se descarta en vez de acumularse en memoria", (done) => {
    const { req } = pedir(`"${"x".repeat(SITE_BEACON_MAX_BYTES + 10)}"`, "text/plain");

    middleware.use(req, res, () => {
      expect(req.body).toBeUndefined();
      done();
    });
  });
});
