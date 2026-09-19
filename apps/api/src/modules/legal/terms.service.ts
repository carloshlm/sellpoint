import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { mustAcceptTerms } from "@sellpoint/shared";
import { CLOCK, type ClockPort } from "../../infrastructure/clock/clock.port";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import type { RequestMeta } from "../auth/auth.service";
import type { AuthUser } from "../auth/types/auth-user";

/**
 * El token de DI que lleva la versión vigente. Es un valor y no una lectura de
 * `CURRENT_TERMS_VERSION` dentro del servicio para que los tests puedan probar
 * los DOS estados —dormido y encendido— sin mockear un módulo entero; lo mismo
 * que ya hacen `CLOCK` y `HASHER` con el tiempo y el hashing.
 */
export const TERMS_VERSION = Symbol("TERMS_VERSION");

/**
 * Lo que devuelve aceptar. Exportado a propósito: un método público de un
 * servicio Nest que devuelve un tipo anónimo rompe `nest build` (TS4053).
 *
 * Los dos campos son nullables por el estado DORMIDO: ahí no hay nada que
 * aceptar, y devolver `null` suelto dejaría el cuerpo de la respuesta vacío.
 */
export interface TermsAcceptance {
  termsVersion: string | null;
  acceptedAt: string | null;
}

/** El sello que el alta de un negocio escribe en la fila del owner. */
export interface TermsAcceptanceStamp {
  termsVersion: string;
  termsAcceptedAt: Date;
}

/**
 * F11-SITE-LEGAL-02/03 — quién aceptó los términos, y quién todavía no.
 *
 * ── Todo nace dormido ───────────────────────────────────────────────────
 * Con `CURRENT_TERMS_VERSION` en `null` este servicio contesta que NADIE debe
 * aceptar nada, el registro no exige casilla y aceptar es un no-op que no
 * toca la base. Es el estado que corre en producción hoy, y por eso cada
 * prueba del `.spec` lo cubre igual que al encendido.
 *
 * ── Por qué una versión y no un booleano ────────────────────────────────
 * «Aceptó» sin decir QUÉ aceptó no prueba nada el día que el texto cambie.
 * Guardando la versión, corregir el aviso es poner una fecha nueva en la
 * constante: todos vuelven a verse el diálogo sin tocar una sola fila.
 */
@Injectable()
export class TermsService {
  constructor(
    @Inject(TERMS_VERSION) private readonly version: string | null,
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    @Inject(CLOCK) private readonly clock: ClockPort,
  ) {}

  /** La versión vigente, o `null` mientras los textos no se publiquen. */
  get currentVersion(): string | null {
    return this.version;
  }

  /** ¿Este usuario tiene que aceptar? Es lo que viaja en la sesión y en `/me`. */
  mustAccept(userTermsVersion: string | null | undefined): boolean {
    return mustAcceptTerms(userTermsVersion, this.version);
  }

  /**
   * El portero del registro. Dormido deja pasar cualquier cosa —el campo se
   * ignora por completo—; encendido exige el `true` LITERAL: un `"true"` de
   * texto o un `1` no son un consentimiento, son un descuido de quien llama.
   */
  requireAcceptance(accepted: boolean | undefined): void {
    if (this.version === null) {
      return;
    }
    if (accepted !== true) {
      throw new BadRequestException({ message: "auth.terms_not_accepted" });
    }
  }

  /**
   * El sello para el INSERT del owner, o `null` cuando no hay nada que sellar.
   * Se llama DESPUÉS de `requireAcceptance`: acá ya se sabe que dijo que sí.
   */
  acceptanceForRegistration(): TermsAcceptanceStamp | null {
    if (this.version === null) {
      return null;
    }
    return { termsVersion: this.version, termsAcceptedAt: this.clock.now() };
  }

  /**
   * La aceptación de quien YA tenía cuenta (F11-SITE-LEGAL-03).
   *
   * Idempotente: si la fila ya trae la versión vigente no se reescribe nada y
   * se devuelve la fecha ORIGINAL. Mover esa fecha por un doble clic o por un
   * reintento del navegador falsearía el único dato que importa — cuándo
   * aceptó de verdad.
   *
   * `users` tiene RLS, así que todo pasa por `withTenantContext` como el
   * código vecino.
   */
  async accept(user: AuthUser, meta: RequestMeta): Promise<TermsAcceptance> {
    const version = this.version;
    if (version === null) {
      return { termsVersion: null, acceptedAt: null };
    }

    const ahora = this.clock.now();

    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const actual = await tx.user.findUniqueOrThrow({
        where: { id: user.userId },
        select: { termsVersion: true, termsAcceptedAt: true },
      });

      if (actual.termsVersion === version) {
        return {
          termsVersion: version,
          acceptedAt: actual.termsAcceptedAt?.toISOString() ?? null,
        };
      }

      await tx.user.update({
        where: { id: user.userId },
        data: { termsVersion: version, termsAcceptedAt: ahora },
      });

      await this.auditService.record(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: "legal.terms.accepted",
        resourceType: "user",
        resourceId: user.userId,
        before: { termsVersion: actual.termsVersion },
        after: { termsVersion: version },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      return { termsVersion: version, acceptedAt: ahora.toISOString() };
    });
  }
}
