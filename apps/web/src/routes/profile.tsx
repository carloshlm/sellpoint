import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { OnboardingGate } from "@/components/auth/onboarding-gate";
import { ProtectedRoute } from "@/components/auth/protected-route";
import { AppLayout } from "@/components/layout/app-layout";
import { ActiveSessions } from "@/components/profile/active-sessions";
import { BusinessDetails } from "@/components/profile/business-details";
import { ChangePasswordForm } from "@/components/profile/change-password-form";
import { LanguagePreference } from "@/components/profile/language-preference";
import { MedicalClinicSettings } from "@/components/profile/medical-clinic-settings";
import { ProfileDetails } from "@/components/profile/profile-details";
import { ReceptionSettings } from "@/components/profile/reception-settings";
import { ThemePreference } from "@/components/profile/theme-preference";
import { TicketSettings } from "@/components/profile/ticket-settings";
import { useAuthStore } from "@/stores/auth.store";

export const Route = createFileRoute("/profile")({
  component: ProfilePage,
});

/**
 * F1-WEB-AUTH-10: ruta protegida + shell autenticado. La página solo COMPONE;
 * cada bloque es un container autónomo con su propia carga/mutación, así que
 * un fallo en las sesiones activas no rompe el formulario de password.
 */
function ProfilePage() {
  return (
    <ProtectedRoute>
      <OnboardingGate>
        <AppLayout>
          <ProfileContent />
        </AppLayout>
      </OnboardingGate>
    </ProtectedRoute>
  );
}

function ProfileContent() {
  const { t } = useTranslation();
  const user = useAuthStore((state) => state.user);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold" data-testid="profile-title">
        {t("common.profile.title")}
      </h1>
      {/*
        `user` puede ser null un instante si el bootstrap todavía no trajo la
        identidad (ProtectedRoute deja pasar apenas hay token). Los bloques que
        dependen de él se montan cuando llega; el resto no espera.
      */}
      {user && <ProfileDetails user={user} />}
      {/* Preferencias va pegada a "Tus datos" (Carlos, 2026-08-26): ambas
          hablan de la PERSONA; lo del negocio viene después. */}
      <LanguagePreference />
      {/* Las tarjetas deciden solas si existen: sin tenants:manage devuelven null. */}
      {user && <BusinessDetails user={user} />}
      {user && <TicketSettings user={user} />}
      {user && <ReceptionSettings user={user} />}
      {user && <MedicalClinicSettings user={user} />}
      {user && <ThemePreference user={user} />}
      <ChangePasswordForm />
      <ActiveSessions />
    </div>
  );
}
