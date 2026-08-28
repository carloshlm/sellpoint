import { useEffect, useRef } from "react";
import { usePlan } from "@/lib/billing/use-plan";
import { useBillingStore } from "@/stores/billing.store";
import { PlansModal } from "./plans-modal";

/**
 * F7-WEB-05 — el gate del free tier, montado UNA vez en `AppLayout` (y no
 * ruta por ruta como el OnboardingGate): una ruta nueva jamás puede olvidar
 * el gate porque el gate vive en el layout que todas comparten.
 *
 * SIN `<Navigate/>` a propósito: el free tier "puede iniciar sesión y ver
 * todo" — se le muestra la app CON el modal de planes encima, cerrable para
 * mirar. Que reaparezca en cada sesión no es un condicional: el estado del
 * modal vive SOLO en memoria (billing.store) y muere con la pestaña.
 */
export function PlanGate() {
  const { status } = usePlan();
  const openPlansModal = useBillingStore((state) => state.openPlansModal);
  // Una vez por montaje: el usuario puede cerrarlo y seguir mirando sin que
  // cada render se lo vuelva a plantar en la cara.
  const yaAbierto = useRef(false);

  useEffect(() => {
    if (status === "free" && !yaAbierto.current) {
      yaAbierto.current = true;
      openPlansModal();
    }
  }, [status, openPlansModal]);

  return <PlansModal />;
}
