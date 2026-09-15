import type { PlanFeatures } from "@sellpoint/shared";
import { Lock } from "lucide-react";
import type * as React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { usePlan } from "@/lib/billing/use-plan";
import { useBillingStore } from "@/stores/billing.store";

/**
 * F9-PLANLIST-05 — la puerta de una pantalla que el plan no incluye.
 *
 * El menú ya mostraba el candado, pero la URL seguía abriendo la pantalla
 * (Carlos, 2026-09-15: «que no pueda entrar a otros lugares»). Es el hermano
 * de `PermissionGate`: aquel responde si el ROL puede; este, si el PLAN lo
 * incluye. Y dice qué falta con el mismo nombre que la vitrina de planes,
 * para que quien lo lea sepa qué buscar al comparar.
 *
 * Solo el web cierra la puerta: el API sigue sirviendo las lecturas (LEY del
 * guard), así que un negocio que bajó de plan no pierde datos — pierde la
 * pantalla hasta que vuelva a subir.
 */
export function FeatureLockCard({ feature }: { feature: keyof PlanFeatures }) {
  const { t } = useTranslation();
  const openPlansModal = useBillingStore((state) => state.openPlansModal);
  const nombre = t(`common.billing.capabilities.${feature}`);

  return (
    <Card data-testid={`feature-lock-${feature}`} className="max-w-xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Lock className="size-4 shrink-0" aria-hidden="true" />
          {t("common.billing.gate.title", { feature: nombre })}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col items-start gap-3">
        <p className="text-muted-foreground text-sm">{t("common.billing.gate.body")}</p>
        <Button type="button" onClick={openPlansModal}>
          {t("common.billing.gate.cta")}
        </Button>
      </CardContent>
    </Card>
  );
}

export function FeatureGate({
  feature,
  children,
}: {
  feature: keyof PlanFeatures;
  children: React.ReactNode;
}) {
  const { hasFeature } = usePlan();

  if (!hasFeature(feature)) {
    return <FeatureLockCard feature={feature} />;
  }

  return <>{children}</>;
}
