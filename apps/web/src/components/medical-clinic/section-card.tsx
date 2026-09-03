import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { RecordCard, SectionStatus } from "@/lib/medical-clinic/sections";
import { cn } from "@/lib/utils";
import { StatusPill } from "./status-pill";

const CARD_CLASS =
  "flex h-full w-full items-start gap-3 rounded-lg border bg-card p-4 text-left transition-colors";
const LINK_CLASS = `${CARD_CLASS} hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring`;

interface SectionCardProps {
  card: RecordCard;
  recordId: string;
  status: SectionStatus;
  /** Se pinta solo si la sección está capturada. */
  summary: string | null;
}

/**
 * F9-CLINIC-WEB-10 — una tarjeta del tablero.
 *
 * Funcional = `<Link>` a su ruta, con el estado en el nombre accesible para
 * que un lector de pantalla diga «Datos Generales — Completado» de una vez.
 * Placeholder = `<div aria-disabled>`: sin link, sin tabindex, con
 * «Próximamente» para que nadie la crea rota.
 */
export function SectionCard({ card, recordId, status, summary }: SectionCardProps) {
  const { t } = useTranslation();
  const title = t(`medicalClinic.sections.${card.key}.title`);
  const Icon = card.icon;
  const testId = `record-card-${card.key}`;

  const cuerpo = (
    <>
      <Icon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="font-medium leading-tight">{title}</span>
        {card.kind === "section" || card.kind === "orders_list" ? (
          <StatusPill status={status} />
        ) : null}
        {status === "completed" && summary ? (
          <span className="line-clamp-2 text-muted-foreground text-xs">{summary}</span>
        ) : null}
        {!card.functional ? (
          <span className="text-muted-foreground text-xs">
            {t("medicalClinic.sections.comingSoon")}
          </span>
        ) : null}
      </span>
    </>
  );

  if (!card.functional) {
    return (
      <div aria-disabled="true" data-testid={testId} className={cn(CARD_CLASS, "opacity-60")}>
        {cuerpo}
      </div>
    );
  }

  const label = `${title} — ${t(`medicalClinic.status.${status}`)}`;
  const className = cn(LINK_CLASS, status === "completed" && "border-success/40");
  const chevron = (
    <ChevronRight
      aria-hidden="true"
      className="size-4 shrink-0 self-center text-muted-foreground"
    />
  );
  const enlace = (children: ReactNode) => children;

  if (card.kind === "section") {
    return (
      <Link
        to="/medical-clinic/records/$recordId/sections/$sectionKey"
        params={{ recordId, sectionKey: card.key }}
        aria-label={label}
        data-testid={testId}
        className={className}
      >
        {enlace(cuerpo)}
        {chevron}
      </Link>
    );
  }
  if (card.kind === "order") {
    return (
      <Link
        to="/medical-clinic/records/$recordId/orders/$orderKind"
        params={{ recordId, orderKind: card.key }}
        aria-label={label}
        data-testid={testId}
        className={className}
      >
        {cuerpo}
        {chevron}
      </Link>
    );
  }
  return (
    <Link
      to="/medical-clinic/records/$recordId/orders"
      params={{ recordId }}
      aria-label={label}
      data-testid={testId}
      className={className}
    >
      {cuerpo}
      {chevron}
    </Link>
  );
}
