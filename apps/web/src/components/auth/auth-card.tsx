import type * as React from "react";

import { LanguageSwitcher } from "@/components/auth/language-switcher";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface AuthCardProps {
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

/**
 * Shell presentacional de las páginas públicas de auth: centrado, mobile-first
 * (full-width en móvil, max-w-md de tablet en adelante), sobre bg-background.
 *
 * El selector de idioma vive ACÁ y no en cada ruta (decisión de Carlos,
 * 2026-08-16): así lo heredan de una login, register, forgot/reset password,
 * verify-email y accept-invitation, sin que ninguna pantalla pública futura
 * pueda nacer sin él. Va arriba de todo, alineado a la derecha: visible sin
 * competir con el formulario, que es donde tiene que estar la atención.
 */
function AuthCard({ title, description, children, footer }: AuthCardProps) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background p-4">
      <div className="flex w-full max-w-md flex-col gap-4">
        <div className="flex justify-end">
          <LanguageSwitcher />
        </div>
        <p className="text-center text-2xl font-semibold text-primary">SellPoint</p>
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{title}</CardTitle>
            {description && <CardDescription>{description}</CardDescription>}
          </CardHeader>
          <CardContent className="flex flex-col gap-4">{children}</CardContent>
        </Card>
        {footer && <div className="text-center text-sm text-muted-foreground">{footer}</div>}
      </div>
    </main>
  );
}

export { AuthCard };
