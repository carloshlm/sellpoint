import { Injectable, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";

/**
 * El tope del cuerpo de un beacon. Un evento son unos 150 bytes; 2 kB da aire
 * de sobra y acota la memoria, porque el parser global de JSON —que tiene su
 * propio límite— no mira las peticiones `text/plain`.
 */
export const SITE_BEACON_MAX_BYTES = 2_048;

/**
 * F11-SITE-SEO-06 — deja que `POST /public/site-events` acepte el cuerpo que
 * manda `navigator.sendBeacon`.
 *
 * ── La decisión, y por qué ──────────────────────────────────────────────
 * `sendBeacon` puede mandar un `Blob` con `type: "application/json"`, y eso
 * sería más limpio… salvo por una cosa: un `Content-Type` que no es
 * `text/plain`, `application/x-www-form-urlencoded` o `multipart/form-data`
 * convierte la petición en NO simple y dispara **preflight CORS**. El
 * preflight es una petición aparte, y el momento típico de un beacon es la
 * página cerrándose: ahí un `OPTIONS` puede quedarse sin completar y el evento
 * se pierde en silencio.
 *
 * Por eso el contrato del sitio es `sendBeacon(url, new Blob([json], { type:
 * "text/plain;charset=UTF-8" }))` — petición simple, cero preflight. Y por eso
 * existe este middleware: el parser de JSON de Express ignora `text/plain`, así
 * que el cuerpo llega sin leer y hay que leerlo aquí.
 *
 * `application/json` SIGUE funcionando (lo parsea Express y este middleware no
 * lo toca): el sitio puede mandar cualquiera de los dos, pero el recomendado es
 * `text/plain`.
 *
 * Se monta SOLO en esa ruta (`SiteModule.configure`), nunca global: un parser
 * de `text/plain` para toda la app cambiaría el cuerpo de endpoints ajenos.
 */
@Injectable()
export class SiteBeaconBodyMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction): void {
    const contentType = req.headers["content-type"] ?? "";
    if (!contentType.startsWith("text/plain")) {
      next();
      return;
    }

    let raw = "";
    let toBig = false;

    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      if (toBig) {
        return;
      }
      if (raw.length + chunk.length > SITE_BEACON_MAX_BYTES) {
        toBig = true;
        raw = "";
        return;
      }
      raw += chunk;
    });
    req.on("end", () => {
      // Sin cuerpo válido se deja `undefined`: el servicio lo descarta con el
      // mismo 202 de siempre, que es todo lo que un beacon puede recibir.
      try {
        req.body = toBig ? undefined : JSON.parse(raw);
      } catch {
        req.body = undefined;
      }
      next();
    });
    req.on("error", () => {
      req.body = undefined;
      next();
    });
  }
}
