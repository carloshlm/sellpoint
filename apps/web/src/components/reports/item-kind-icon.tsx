import { FileText, type LucideIcon, Package, Wrench } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { SoldItemKind } from "@/lib/dashboard/api";

/**
 * Los íconos de la pantalla de Reportes (decisión 3 de F10-RPT): el mismo
 * dibujo dice lo mismo en todos lados. Son los del panel («Más vendidos» y
 * «Mayor utilidad», F10-RPT-01).
 */
const ICONO_DEL_TIPO: Record<SoldItemKind, LucideIcon> = {
  product: Package,
  service: Wrench,
  concept: FileText,
};

/**
 * F10-RPT-04 — si el artículo es un producto, un servicio o un concepto, con
 * su nombre para quien no ve el ícono («Producto», «Servicio», «Concepto»:
 * los mismos textos del panel).
 */
export function ItemKindIcon({ kind }: { kind: SoldItemKind }) {
  const { t } = useTranslation();
  const Icono = ICONO_DEL_TIPO[kind];
  return (
    <Icono
      role="img"
      aria-label={t(`dashboard.top.kind.${kind}`)}
      className="size-4 shrink-0 text-muted-foreground"
    />
  );
}
