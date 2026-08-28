import { create } from "zustand";

/**
 * F7-WEB-04/05 — el estado del modal de planes, SOLO en memoria a propósito
 * (nunca localStorage): el requisito dice que al free tier se le muestra en
 * CADA inicio de sesión, y un estado que muere con la pestaña lo cumple por
 * construcción — no por un condicional que alguien pueda romper.
 */
interface BillingState {
  plansModalOpen: boolean;
  openPlansModal: () => void;
  closePlansModal: () => void;
}

export const useBillingStore = create<BillingState>((set) => ({
  plansModalOpen: false,
  openPlansModal: () => set({ plansModalOpen: true }),
  closePlansModal: () => set({ plansModalOpen: false }),
}));
