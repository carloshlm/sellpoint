import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@/i18n";
import { RECORD_CARDS } from "@/lib/medical-clinic/sections";
import { SectionCard } from "./section-card";

/**
 * F9-CLINIC-WEB-10 — la tarjeta del tablero: funcional = link enfocable;
 * placeholder = inerte, con «Próximamente», fuera del orden de tabulación.
 */
function renderCard(ui: React.ReactNode) {
  const root = createRootRoute({ component: () => <>{ui}</> });
  const router = createRouter({ routeTree: root, history: createMemoryHistory() });
  render(
    <I18nextProvider i18n={createI18n()}>
      <RouterProvider router={router} />
    </I18nextProvider>,
  );
}

const card = (key: string) => {
  const c = RECORD_CARDS.find((x) => x.key === key);
  if (!c) throw new Error(key);
  return c;
};

describe("SectionCard", () => {
  it("una funcional es un link con su ruta, enfocable, con el estado en el nombre", async () => {
    renderCard(
      <SectionCard
        card={card("general_data")}
        recordId="r1"
        status="completed"
        summary="F · Docente"
      />,
    );
    const link = await screen.findByRole("link", { name: "Datos Generales — Completado" });
    expect(link).toHaveAttribute("href", "/medical-clinic/records/r1/sections/general_data");
    expect(link).toHaveTextContent("F · Docente");
    link.focus();
    expect(link).toHaveFocus();
  });

  it("una placeholder no es link, no es enfocable y dice Próximamente y Pendiente", async () => {
    renderCard(
      <SectionCard card={card("allergies")} recordId="r1" status="pending" summary={null} />,
    );
    expect(await screen.findByText("Alergias")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    const caja = screen.getByText("Alergias").closest('[aria-disabled="true"]');
    expect(caja).not.toBeNull();
    expect(caja).toHaveTextContent("Próximamente");
    expect(caja).toHaveTextContent("Pendiente");
    expect(caja?.querySelector("[tabindex]")).toBeNull();
  });

  it("las tarjetas de órdenes enlazan a su ruta", async () => {
    renderCard(
      <SectionCard card={card("lab_order")} recordId="r1" status="pending" summary={null} />,
    );
    expect(await screen.findByRole("link", { name: /Orden de Laboratorio/ })).toHaveAttribute(
      "href",
      "/medical-clinic/records/r1/orders/lab_order",
    );
  });
});
