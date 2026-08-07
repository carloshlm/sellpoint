// Puerto de reloj: testeabilidad de TTLs sin fake timers de jest (f1-auth
// design §6). Todo código que compara contra "ahora" (expiración de tokens,
// TTL de throttle, epochs) inyecta esto en vez de llamar `new Date()`.
export const CLOCK = Symbol("CLOCK");

export interface ClockPort {
  now(): Date;
}
