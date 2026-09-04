import { Injectable, UnprocessableEntityException } from "@nestjs/common";
import {
  DEFAULT_TICKET_SETTINGS,
  TICKET_LOGO_SVG,
  type TicketLogoPreset,
  type TicketSettings,
} from "@sellpoint/shared";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import type { RequestMeta } from "../auth/auth.service";
import type { AuthUser } from "../auth/types/auth-user";
import type { UpdateTicketSettingsDto } from "./dto/ticket-settings.dto";
import { LogoRejected, processTicketLogo } from "./logo-processor";

/** Lo que un renderer pinta arriba del papel: el SVG del preset o el PNG propio. */
export type TicketLogoRender = { svg: string } | { dataUrl: string } | null;

/** La configuración para la tarjeta de Mi perfil: con la vista previa del PNG. */
export interface TicketSettingsView extends TicketSettings {
  logoDataUrl: string | null;
}

type Tx = Parameters<Parameters<PrismaService["withTenantContext"]>[1]>[0];

interface Fila {
  showBusinessName: boolean;
  showTaxId: boolean;
  showAddress: boolean;
  showPhone: boolean;
  showWarehouse: boolean;
  footerMessage: string | null;
  logoKind: string;
  logoPreset: string | null;
  logoPng: Uint8Array | Buffer | null;
  logoWidth: number | null;
  logoHeight: number | null;
}

/** Las columnas del logotipo en blanco: lo que cualquier cambio de tipo deja atrás. */
const SIN_LOGO = { logoPreset: null, logoPng: null, logoWidth: null, logoHeight: null } as const;

/**
 * F4-TICKETCFG-04 — qué del negocio se imprime y con qué logotipo.
 *
 * Sin fila valen los defaults de shared (los mismos que las columnas). El
 * logotipo propio se procesa aquí (`processTicketLogo`) y se guarda en la
 * MISMA fila: reemplazarlo es un UPDATE, así que la imagen anterior
 * desaparece con él — no hay copia en disco ni en un bucket que limpiar.
 *
 * `leer(tx)` es lo que consumen los tres papeles dentro de su transacción y
 * ya devuelve lo pintable (SVG o data URL); los renderers no saben de dónde
 * salió el logotipo.
 */
@Injectable()
export class TicketSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async leer(
    tx: Tx,
    tenantId: string,
  ): Promise<{ settings: TicketSettings; logo: TicketLogoRender }> {
    const fila = await tx.ticketSettings.findUnique({ where: { tenantId } });
    if (fila === null) {
      return { settings: { ...DEFAULT_TICKET_SETTINGS }, logo: null };
    }
    return { settings: toSettings(fila), logo: renderDe(fila) };
  }

  async get(user: AuthUser): Promise<TicketSettingsView> {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const fila = await tx.ticketSettings.findUnique({ where: { tenantId: user.tenantId } });
      return fila === null ? { ...DEFAULT_TICKET_SETTINGS, logoDataUrl: null } : toView(fila);
    });
  }

  async update(
    user: AuthUser,
    input: UpdateTicketSettingsDto,
    meta: RequestMeta,
  ): Promise<TicketSettingsView> {
    const { logo, ...resto } = input;
    const cambios = {
      ...resto,
      // Cambiar de tipo de logotipo deja en blanco lo del tipo anterior: el
      // CHECK de la base exige la forma exacta de cada tipo.
      ...(logo !== undefined && {
        logoKind: logo.kind,
        ...SIN_LOGO,
        ...(logo.kind === "preset" && { logoPreset: logo.preset }),
      }),
    };
    return this.guardar(user, cambios, meta);
  }

  async setLogo(
    user: AuthUser,
    contentBase64: string,
    meta: RequestMeta,
  ): Promise<TicketSettingsView> {
    let bytes: Buffer;
    try {
      bytes = Buffer.from(contentBase64, "base64");
    } catch {
      throw new UnprocessableEntityException({ message: "tenants.ticket_logo_not_image" });
    }
    let procesado: Awaited<ReturnType<typeof processTicketLogo>>;
    try {
      procesado = await processTicketLogo(bytes);
    } catch (error) {
      if (error instanceof LogoRejected) {
        throw new UnprocessableEntityException({ message: `tenants.ticket_logo_${error.reason}` });
      }
      throw error;
    }
    return this.guardar(
      user,
      {
        logoKind: "custom",
        logoPreset: null,
        logoPng: procesado.png,
        logoWidth: procesado.width,
        logoHeight: procesado.height,
      },
      meta,
    );
  }

  async clearLogo(user: AuthUser, meta: RequestMeta): Promise<TicketSettingsView> {
    return this.guardar(user, { logoKind: "none", ...SIN_LOGO }, meta);
  }

  private async guardar(
    user: AuthUser,
    cambios: Record<string, unknown>,
    meta: RequestMeta,
  ): Promise<TicketSettingsView> {
    return this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const previa = await tx.ticketSettings.findUnique({ where: { tenantId: user.tenantId } });
      const antes = previa === null ? { ...DEFAULT_TICKET_SETTINGS } : toSettings(previa);
      const fila = await tx.ticketSettings.upsert({
        where: { tenantId: user.tenantId },
        create: { tenantId: user.tenantId, ...cambios, updatedBy: user.userId },
        update: { ...cambios, updatedBy: user.userId },
      });
      const despues = toSettings(fila);
      // La auditoría describe el logotipo (tipo, preset, medidas) y NUNCA
      // lleva los bytes: un PNG en cada renglón del historial es basura.
      await this.auditService.record(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: "tenant.ticket_settings.update",
        resourceType: "ticket_settings",
        resourceId: user.tenantId,
        before: { ...antes },
        after: {
          ...despues,
          ...(fila.logoKind === "custom" && {
            logoWidth: fila.logoWidth,
            logoHeight: fila.logoHeight,
          }),
        },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return toView(fila);
    });
  }
}

function toSettings(fila: Fila): TicketSettings {
  return {
    showBusinessName: fila.showBusinessName,
    showTaxId: fila.showTaxId,
    showAddress: fila.showAddress,
    showPhone: fila.showPhone,
    showWarehouse: fila.showWarehouse,
    footerMessage: fila.footerMessage,
    logo:
      fila.logoKind === "preset" && fila.logoPreset !== null
        ? { kind: "preset", preset: fila.logoPreset as TicketLogoPreset }
        : fila.logoKind === "custom"
          ? { kind: "custom" }
          : { kind: "none" },
  };
}

function dataUrlDe(png: Uint8Array | Buffer): string {
  return `data:image/png;base64,${Buffer.from(png).toString("base64")}`;
}

function renderDe(fila: Fila): TicketLogoRender {
  if (fila.logoKind === "preset" && fila.logoPreset !== null) {
    const svg = TICKET_LOGO_SVG[fila.logoPreset as TicketLogoPreset];
    return svg === undefined ? null : { svg };
  }
  if (fila.logoKind === "custom" && fila.logoPng !== null) {
    return { dataUrl: dataUrlDe(fila.logoPng) };
  }
  return null;
}

function toView(fila: Fila): TicketSettingsView {
  return {
    ...toSettings(fila),
    logoDataUrl:
      fila.logoKind === "custom" && fila.logoPng !== null ? dataUrlDe(fila.logoPng) : null,
  };
}
