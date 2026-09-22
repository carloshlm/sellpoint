import { Eye, EyeOff } from "lucide-react";
import type * as React from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { TextField } from "@/components/form/text-field";

type PasswordFieldProps = Omit<React.ComponentProps<typeof TextField>, "type" | "trailing">;

/**
 * Un `TextField` de contraseña con el ojo para verla (Carlos, 2026-09-22): se
 * escribe a ciegas y un carácter mal tecleado cuesta un intento, o una cuenta
 * nueva con una contraseña que nadie conoce. Nace oculta; el botón alterna y
 * DICE lo que hace (`aria-pressed` + etiqueta), y es `type="button"` para no
 * enviar el formulario. El estado no sale del componente: cada campo tiene su
 * propio ojo.
 */
function PasswordField(props: PasswordFieldProps) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  return (
    <TextField
      type={visible ? "text" : "password"}
      trailing={
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-pressed={visible}
          aria-label={visible ? t("common.form.hidePassword") : t("common.form.showPassword")}
          className="rounded-sm p-1.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {visible ? (
            <EyeOff className="size-4" aria-hidden />
          ) : (
            <Eye className="size-4" aria-hidden />
          )}
        </button>
      }
      {...props}
    />
  );
}

export { PasswordField };
