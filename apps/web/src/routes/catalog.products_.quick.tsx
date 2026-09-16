import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { OnboardingGate } from "@/components/auth/onboarding-gate";
import { PermissionGate } from "@/components/auth/permission-gate";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { QuickCatalogTable } from "@/components/catalog/quick-catalog-table";
import { AppLayout } from "@/components/layout/app-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuthStore } from "@/stores/auth.store";

/**
 * F10-QUICKCAT-07 — `/catalog/products/quick`.
 *
 * El guion bajo en `products_` no es un adorno: sin él, TanStack Router
 * trataría `catalog.products.tsx` como el LAYOUT de esta pantalla y exigiría
 * un `<Outlet />` allá. El listado de productos es una hoja, no un contenedor,
 * y esta pantalla es su hermana.
 *
 * Pantalla completa y no un diálogo porque una sesión de carga dura media hora
 * y necesita la tabla entera a la vista, la URL propia para volver, y el botón
 * ATRÁS del navegador funcionando.
 */
export const Route = createFileRoute("/catalog/products_/quick")({
  component: QuickCatalogPage,
});

function QuickCatalogPage() {
  return (
    <ProtectedRoute>
      <OnboardingGate>
        <AppLayout>
          <PermissionGate need="products:manage">
            <QuickCatalogContent />
          </PermissionGate>
        </AppLayout>
      </OnboardingGate>
    </ProtectedRoute>
  );
}

function QuickCatalogContent() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const tenantId = useAuthStore((s) => s.user?.tenant.id ?? "");
  const userId = useAuthStore((s) => s.user?.id ?? "");

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-semibold text-2xl">{t("products.quick.title")}</h1>
        <Button variant="outline" onClick={() => navigate({ to: "/catalog/products" })}>
          {t("products.quick.back")}
        </Button>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>{t("products.quick.cardTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          {/* El sello de dueño del borrador. Ver el store: entrar con otra
              cuenta lo descarta en vez de dar de alta el catálogo del vecino. */}
          <QuickCatalogTable owner={`${tenantId}:${userId}`} />
        </CardContent>
      </Card>
    </div>
  );
}
