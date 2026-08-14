import { render, screen, within } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@/i18n";
import type { ActiveSession } from "@/lib/auth/api";
import { formatSessionDate, SessionList } from "./active-sessions";

function session(overrides: Partial<ActiveSession> = {}): ActiveSession {
  return {
    familyId: "fam-1",
    createdAt: "2026-08-12T15:30:00.000Z",
    expiresAt: "2026-08-19T15:30:00.000Z",
    current: false,
    ...overrides,
  };
}

function renderList(sessions: ActiveSession[], locale = "es") {
  return render(
    <I18nextProvider i18n={createI18n()}>
      <SessionList sessions={sessions} locale={locale} />
    </I18nextProvider>,
  );
}

describe("formatSessionDate (F1-WEB-AUTH-10)", () => {
  const iso = "2026-08-12T15:30:00.000Z";

  it("formatea con el locale pedido: es y en producen textos DISTINTOS para la misma fecha", () => {
    const es = formatSessionDate(iso, "es");
    const en = formatSessionDate(iso, "en");

    expect(es).not.toBe(en);
    // El mes va en palabras según el idioma, no como número ambiguo.
    expect(es.toLowerCase()).toContain("agosto");
    expect(en.toLowerCase()).toContain("august");
  });

  it("incluye año y hora (no solo la fecha): una sesión de hace un año no debe parecer de hoy", () => {
    const formatted = formatSessionDate(iso, "es");

    expect(formatted).toContain("2026");
    expect(formatted).toMatch(/\d{1,2}:\d{2}/);
  });
});

describe("SessionList", () => {
  it("renderiza una entrada por sesión con inicio y vencimiento", () => {
    renderList([session({ familyId: "a" }), session({ familyId: "b" })]);

    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Iniciada el");
    expect(items[0]).toHaveTextContent("Vence el");
  });

  it("marca 'Esta sesión' SOLO en la actual", () => {
    renderList([session({ familyId: "a", current: true }), session({ familyId: "b" })]);

    const items = screen.getAllByRole("listitem");
    expect(within(items[0] as HTMLElement).getByText("Esta sesión")).toBeInTheDocument();
    expect(within(items[1] as HTMLElement).queryByText("Esta sesión")).not.toBeInTheDocument();
  });

  it("sin sesiones muestra el vacío explicado, no una lista fantasma", () => {
    renderList([]);

    expect(screen.getByText("No hay otras sesiones activas.")).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("NUNCA muestra el familyId (identificador interno, no dato de usuario)", () => {
    renderList([session({ familyId: "fam-secreta-123", current: true })]);

    expect(screen.getByRole("list")).not.toHaveTextContent("fam-secreta-123");
  });
});
