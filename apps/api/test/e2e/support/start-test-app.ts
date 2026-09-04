import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { JSON_BODY_LIMIT } from "../../../src/common/http/body-limits";

/**
 * Arranca la app de un e2e: `init()` **y `listen(0)`**.
 *
 * ── El bug que este helper existe para evitar ───────────────────────────
 *
 * `app.init()` construye la aplicación pero **no la pone a escuchar**. Con el
 * servidor sin dirección, supertest hace lo único que puede: abre un listener
 * efímero para cada petición y lo cierra al recibir la respuesta. Un puerto
 * quemado por request.
 *
 * Medido sobre `pos-lookup.e2e-spec.ts` el 2026-08-21:
 *
 *     app.init() solo    → 110 requests, 110 puertos distintos
 *     + app.listen(0)    → 110 requests, 1 puerto
 *
 * Una corrida completa hace más de 4.000 peticiones. El rango efímero de macOS
 * es 49152-65535 (~16k) y TIME_WAIT dura 15 segundos, así que los puertos se
 * reciclan mientras el anterior sigue muriendo: el cliente lee datos de una
 * conexión ajena y sale `read ECONNRESET` o
 * `Parse Error: Expected HTTP/, RTSP/ or ICE/`.
 *
 * ── Por qué costó días encontrarlo ──────────────────────────────────────
 *
 * Las tres propiedades del flake se explican solas una vez que se ve la causa,
 * y las tres apuntaban en la dirección equivocada:
 *
 *  · **cambiaba de spec en cada corrida** —el puerto que colisiona es azaroso—
 *    y eso hacía pensar en una interferencia entre suites;
 *  · **siempre pasaba aislado**, porque una sola suite no agota el rango, lo
 *    que hacía pensar en un problema de orden o de estado compartido;
 *  · **empeoró de golpe** un día de muchas corridas seguidas, porque el pool de
 *    TIME_WAIT nunca alcanzaba a drenar — y eso se leyó como «la máquina está
 *    saturada», que era una correlación, no la causa.
 *
 * `maxWorkers` ya estaba en 1: nunca fue paralelismo entre workers.
 *
 * ── Cómo comprobar que un spec está sano ────────────────────────────────
 *
 *     pnpm test:e2e -- <spec> > /tmp/log 2>&1
 *     rg -o '"host":"127.0.0.1:[0-9]+"' /tmp/log | sort -u | wc -l   # puertos
 *     rg -c "request completed" /tmp/log                             # requests
 *
 * Si los dos números coinciden, ese spec está quemando un puerto por petición.
 * Sano es: muchos requests, UN puerto.
 *
 * `app.close()` cierra el listener junto con el resto, así que el `afterAll`
 * que ya tienen todos los specs no cambia.
 */
export async function startTestApp(app: INestApplication): Promise<void> {
  // El MISMO tope de body que producción: un e2e que sube una imagen o un
  // CSV grande tiene que pasar por el mismo parser que el usuario.
  // Toda app de e2e es Express (`createNestApplication()` sin adaptador):
  // `useBodyParser` vive en el tipo de la plataforma, no en la interfaz.
  (app as NestExpressApplication).useBodyParser("json", { limit: JSON_BODY_LIMIT });
  await app.init();
  // El puerto 0 se lo pide al sistema operativo: dos suites que corrieran a la
  // vez no pelearían por un número fijo.
  await app.listen(0);
}
