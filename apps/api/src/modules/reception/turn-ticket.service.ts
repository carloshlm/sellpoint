import { Injectable, NotFoundException } from "@nestjs/common";
import PdfPrinter from "pdfmake";
import type { TDocumentDefinitions } from "pdfmake/interfaces";
import { PrismaService } from "../../infrastructure/prisma/prisma.service";
import type { AuthUser } from "../auth/types/auth-user";
import type { TicketWidth, Translate } from "../pos/ticket.renderer";
import { TicketSettingsService } from "../tenants/ticket-settings.service";
import { buildTurnTicketDefinition, type TurnTicketInput } from "./turn-ticket.renderer";

/** Las Type1 de pdfkit, igual que el ticket del POS: nada que empaquetar. */
const FONTS = {
  Helvetica: {
    normal: "Helvetica",
    bold: "Helvetica-Bold",
    italics: "Helvetica-Oblique",
    bolditalics: "Helvetica-BoldOblique",
  },
};

/** El binario del papel del turno; la plantilla vive en el renderer. */
@Injectable()
export class TurnTicketService {
  private readonly printer = new PdfPrinter(FONTS);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ticketSettings: TicketSettingsService,
  ) {}

  async turnTicket(
    user: AuthUser,
    turnId: string,
    width: TicketWidth,
    t: Translate,
  ): Promise<{ body: Buffer; filename: string }> {
    const input = await this.prisma.withTenantContext(user.tenantId, async (tx) => {
      const turno = await tx.receptionTurn.findFirst({
        where: { id: turnId, tenantId: user.tenantId },
        select: { number: true, customerName: true, createdAt: true, businessDate: true },
      });
      if (turno === null) {
        throw new NotFoundException({ message: "reception.turn_not_found" });
      }
      const tenant = await tx.tenant.findUniqueOrThrow({
        where: { id: user.tenantId },
        select: { name: true, legalName: true, timezone: true },
      });
      const { settings, logo } = await this.ticketSettings.leer(tx, user.tenantId);
      return {
        logo,
        showBusinessName: settings.showBusinessName,
        tenant: { name: tenant.name, legalName: tenant.legalName },
        number: turno.number,
        customerName: turno.customerName,
        createdAt: turno.createdAt,
        timeZone: tenant.timezone,
        locale: user.locale,
        width,
      } satisfies TurnTicketInput;
    });

    const definition = buildTurnTicketDefinition(input, t) as unknown as TDocumentDefinitions;
    const pdf = this.printer.createPdfKitDocument(definition);
    const body = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      pdf.on("data", (chunk: Buffer) => chunks.push(chunk));
      pdf.on("end", () => resolve(Buffer.concat(chunks)));
      pdf.on("error", reject);
      pdf.end();
    });
    return { body, filename: `turno-${input.number}.pdf` };
  }
}
