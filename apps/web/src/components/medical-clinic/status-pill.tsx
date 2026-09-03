import { Circle, CircleCheck, Clock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import type { GroupStatus } from "@/lib/medical-clinic/sections";

const VARIANT = { pending: "default", inProgress: "warning", completed: "success" } as const;
const ICON = { pending: Circle, inProgress: Clock, completed: CircleCheck } as const;

/** F9-CLINIC-WEB-10 — el estado de una tarjeta o de un grupo, con icono y etiqueta. */
export function StatusPill({ status }: { status: GroupStatus }) {
  const { t } = useTranslation();
  const Icon = ICON[status];
  return (
    <Badge variant={VARIANT[status]} className="gap-1">
      <Icon aria-hidden="true" className="size-3" />
      {t(`medicalClinic.status.${status}`)}
    </Badge>
  );
}
