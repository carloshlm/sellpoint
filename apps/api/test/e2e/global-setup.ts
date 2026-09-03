/**
 * F0-DB-05 — la hora en que arrancó la corrida.
 *
 * El teardown borra lo que la corrida creó, y «lo que creó» se reconoce por
 * `created_at >= este instante`. Va en `process.env` porque setup y teardown
 * corren en el MISMO proceso padre de Jest (los workers son otros).
 */
export default async function globalSetup(): Promise<void> {
  process.env.E2E_RUN_STARTED_AT = new Date().toISOString();
}
