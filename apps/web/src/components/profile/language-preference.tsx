import { SUPPORTED_LOCALES } from "@sellpoint/shared";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { SelectField } from "@/components/form/select-field";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useUpdateLocale } from "@/lib/auth/hooks";
import { useAuthStore } from "@/stores/auth.store";

type Locale = (typeof SUPPORTED_LOCALES)[number];

/**
 * F1-LOCALE-08 (container): selector de idioma en Preferencias.
 *
 * Optimista a propósito: `i18n.changeLanguage` se dispara al instante para
 * que la UI responda sin esperar la red, y si `PATCH /me` falla se revierte
 * al idioma previo y se muestra el error. Lo contrario (esperar al backend)
 * haría que el combo se sintiera roto en conexiones lentas.
 *
 * El `value` del combo sigue a `i18n.language`, NO al locale del store: el
 * selector tiene que mostrar el idioma que estás VIENDO. Atarlo al store lo
 * dejaría un round-trip atrás, mostrando "Español" con la UI ya en inglés.
 * La persistencia va por dos vías complementarias: `PATCH /me` (la cuenta,
 * cualquier dispositivo) y el cache en localStorage del detector de i18next
 * (este navegador, sobrevive al reload).
 *
 * GAP CONOCIDO (no de esta tarea): nada sincroniza i18next con el locale de
 * DB al bootear la sesión, así que en un dispositivo nuevo se ve el idioma
 * del navegador hasta que se cambie acá. Cerrarlo es cablear
 * `changeLanguage(user.locale)` en el bootstrap de sesión.
 */
function LanguagePreference() {
  const { t, i18n } = useTranslation();
  const user = useAuthStore((state) => state.user);
  const setUser = useAuthStore((state) => state.setUser);
  const updateLocale = useUpdateLocale();
  const [failed, setFailed] = useState(false);

  const options = SUPPORTED_LOCALES.map((locale) => ({
    value: locale,
    label: t(`common.profile.preferences.languages.${locale}`),
  }));

  const handleChange = (next: Locale) => {
    const previous = i18n.language;
    setFailed(false);
    void i18n.changeLanguage(next);

    updateLocale.mutate(next, {
      onSuccess: () => {
        if (user) {
          setUser({ ...user, locale: next });
        }
      },
      onError: () => {
        setFailed(true);
        void i18n.changeLanguage(previous);
      },
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("common.profile.preferences.title")}</CardTitle>
      </CardHeader>
      <CardContent>
        <SelectField
          label={t("common.profile.preferences.languageLabel")}
          hint={t("common.profile.preferences.languageHelp")}
          options={options}
          value={i18n.resolvedLanguage ?? i18n.language}
          disabled={updateLocale.isPending}
          error={failed ? t("common.profile.preferences.languageError") : undefined}
          onChange={(event) => handleChange(event.target.value as Locale)}
        />
      </CardContent>
    </Card>
  );
}

export { LanguagePreference };
