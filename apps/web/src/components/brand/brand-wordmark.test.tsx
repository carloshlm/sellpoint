import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AuthCard } from "@/components/auth/auth-card";
import { WizardShell } from "@/components/onboarding/wizard-shell";
import { BrandWordmark } from "./brand-wordmark";

/**
 * La marca de las pantallas de acceso y del wizard (Carlos, 2026-09-19): el
 * logo y «SellPointy» con la letra del sitio. Azul en claro; en oscuro, la
 * palabra en blanco y el logo invertido (círculo blanco, S azul).
 */
describe("BrandWordmark", () => {
  it("es UN nombre para el lector de pantalla: el logo es adorno", () => {
    render(<BrandWordmark />);

    expect(screen.getByText("SellPointy")).toBeInTheDocument();
    for (const logo of document.querySelectorAll("img")) {
      expect(logo).toHaveAttribute("alt", "");
    }
  });

  it("trae las dos variantes y `dark:` decide cuál se ve", () => {
    render(<BrandWordmark />);
    const logos = [...document.querySelectorAll("img")];

    const claro = logos.find((l) => l.getAttribute("src") === "/brand/logo.svg");
    const oscuro = logos.find((l) => l.getAttribute("src") === "/brand/logo-inverted.svg");
    expect(claro?.className).toContain("dark:hidden");
    expect(oscuro?.className).toContain("hidden");
    expect(oscuro?.className).toContain("dark:block");
  });

  it("la palabra va en la letra del sitio y en el azul de la marca, blanca en oscuro", () => {
    render(<BrandWordmark />);
    const palabra = screen.getByText("SellPointy");

    expect(palabra.className).toContain("font-brand");
    expect(palabra.className).toContain("text-brand");
    expect(palabra.className).toContain("dark:text-white");
  });

  it("los dos logos existen en /public: una ruta rota sería una imagen vacía", () => {
    for (const archivo of ["logo.svg", "logo-inverted.svg"]) {
      const svg = readFileSync(resolve(process.cwd(), "public/brand", archivo), "utf8");
      expect(svg).toContain("<svg");
    }
  });
});

describe("dónde va la marca", () => {
  it("en las pantallas de acceso (login, registro, recuperar contraseña…)", () => {
    render(
      <AuthCard title="Crea tu cuenta">
        <p>formulario</p>
      </AuthCard>,
    );
    expect(screen.getByText("SellPointy").className).toContain("font-brand");
  });

  it("en el wizard de alta del negocio", () => {
    render(
      <WizardShell step={1}>
        <p>paso</p>
      </WizardShell>,
    );
    expect(screen.getByText("SellPointy").className).toContain("font-brand");
  });
});
