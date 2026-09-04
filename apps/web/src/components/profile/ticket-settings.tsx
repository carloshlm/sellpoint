import {
  TICKET_FOOTER_MAX,
  TICKET_LOGO_MAX_INPUT_BYTES,
  TICKET_LOGO_PRESETS,
  TICKET_LOGO_SVG,
  type TicketLogoPreset,
} from "@sellpoint/shared";
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { TextField } from "@/components/form/text-field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { SuccessNotice } from "@/components/ui/success-notice";
import type { ApiError } from "@/lib/api";
import {
  fileToBase64,
  type TicketSettingsView,
  type UpdateTicketSettingsInput,
} from "@/lib/tenant/ticket-settings-api";
import {
  useRemoveTicketLogo,
  useTicketSettings,
  useUpdateTicketSettings,
  useUploadTicketLogo,
} from "@/lib/tenant/ticket-settings-hooks";
import type { AuthUser } from "@/stores/auth.store";

const CASILLAS = [
  "showBusinessName",
  "showTaxId",
  "showAddress",
  "showPhone",
  "showWarehouse",
] as const;
type Casilla = (typeof CASILLAS)[number];

/** Lo elegido en la rejilla: «ninguno», un preset, o la imagen propia (que no se elige, se sube). */
type Eleccion = "none" | "custom" | TicketLogoPreset;

interface Formulario {
  casillas: Record<Casilla, boolean>;
  footer: string;
  logo: Eleccion;
}

const desdeSettings = (s: TicketSettingsView): Formulario => ({
  casillas: {
    showBusinessName: s.showBusinessName,
    showTaxId: s.showTaxId,
    showAddress: s.showAddress,
    showPhone: s.showPhone,
    showWarehouse: s.showWarehouse,
  },
  footer: s.footerMessage ?? "",
  logo: s.logo.kind === "preset" ? s.logo.preset : s.logo.kind,
});

/**
 * F4-TICKETCFG-08 — «Configuración del ticket» en Mi perfil.
 *
 * Como las demás tarjetas del perfil, decide sola si existe (`tenants:manage`:
 * es configuración del NEGOCIO). Tres bloques: el logotipo (seis de fábrica o
 * una imagen propia), qué se imprime (cinco casillas que solo deciden si
 * SALE lo que ya existe) y el mensaje del pie. Guardar manda SOLO lo que
 * cambió.
 *
 * La imagen se sube al elegirla —no espera al Guardar— y la vista previa es
 * el PNG que devolvió el API: gris, pequeño, lo que la térmica va a
 * imprimir. Enseñar el archivo original sería prometer un papel que no sale.
 */
export function TicketSettings({ user }: { user: AuthUser }) {
  const { t } = useTranslation();
  const visible = user.permissions.includes("tenants:manage");
  const { data, isError } = useTicketSettings(visible);
  const update = useUpdateTicketSettings();
  const upload = useUploadTicketLogo();
  const remove = useRemoveTicketLogo();
  const [form, setForm] = useState<Formulario | null>(null);
  const [guardado, setGuardado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idArchivo = useId();

  useEffect(() => {
    if (data !== undefined) {
      setForm(desdeSettings(data));
    }
  }, [data]);

  if (!visible) {
    return null;
  }

  const cambios = (): UpdateTicketSettingsInput => {
    if (data === undefined || form === null) return {};
    const diff: UpdateTicketSettingsInput = {};
    for (const casilla of CASILLAS) {
      if (form.casillas[casilla] !== data[casilla]) diff[casilla] = form.casillas[casilla];
    }
    const pie = form.footer.trim() === "" ? null : form.footer.trim();
    if (pie !== data.footerMessage) diff.footerMessage = pie;
    const logoActual: Eleccion = data.logo.kind === "preset" ? data.logo.preset : data.logo.kind;
    // La imagen propia no se elige con un clic: se sube. Aquí solo viajan
    // «ninguno» y los presets.
    if (form.logo !== logoActual && form.logo !== "custom") {
      diff.logo = form.logo === "none" ? { kind: "none" } : { kind: "preset", preset: form.logo };
    }
    return diff;
  };

  const subir = async (file: File | undefined) => {
    if (file === undefined) return;
    setError(null);
    setGuardado(false);
    // Se rechaza ANTES de leerla: mandar 10 MB para que el API los rebote es
    // hacer esperar a la persona por un «no» que ya se sabía.
    if (file.size > TICKET_LOGO_MAX_INPUT_BYTES) {
      setError(t("common.profile.ticket.tooLarge"));
      return;
    }
    try {
      const base64 = await fileToBase64(file);
      upload.mutate(base64, {
        onError: (apiError: ApiError) =>
          setError(apiError.message || t("common.profile.ticket.uploadFailed")),
      });
    } catch {
      setError(t("common.profile.ticket.uploadFailed"));
    }
  };

  const ocupado = update.isPending || upload.isPending || remove.isPending;

  return (
    <Card data-testid="ticket-settings">
      <CardHeader>
        <CardTitle>{t("common.profile.ticket.title")}</CardTitle>
        <CardDescription>{t("common.profile.ticket.subtitle")}</CardDescription>
      </CardHeader>
      <CardContent>
        {isError && (
          <p role="alert" className="text-destructive text-sm">
            {t("common.profile.ticket.loadFailed")}
          </p>
        )}
        {form !== null && data !== undefined && (
          <form
            className="flex max-w-2xl flex-col gap-6"
            onSubmit={(event) => {
              event.preventDefault();
              setError(null);
              setGuardado(false);
              const diff = cambios();
              if (Object.keys(diff).length === 0) return;
              update.mutate(diff, {
                onSuccess: () => setGuardado(true),
                onError: (apiError: ApiError) => setError(apiError.message),
              });
            }}
          >
            {/* ── El logotipo ─────────────────────────────────────────── */}
            <fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
              <legend className="font-medium text-sm">
                {t("common.profile.ticket.logoTitle")}
              </legend>
              <div className="flex flex-wrap gap-2">
                <LogoOpcion
                  etiqueta={t("common.profile.ticket.none")}
                  activo={form.logo === "none"}
                  disabled={ocupado}
                  onClick={() => setForm({ ...form, logo: "none" })}
                />
                {TICKET_LOGO_PRESETS.map((preset) => (
                  <LogoOpcion
                    key={preset}
                    etiqueta={t(`common.profile.ticket.presets.${preset}`)}
                    svg={TICKET_LOGO_SVG[preset]}
                    activo={form.logo === preset}
                    disabled={ocupado}
                    onClick={() => setForm({ ...form, logo: preset })}
                  />
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Label
                  htmlFor={idArchivo}
                  className="inline-flex h-9 cursor-pointer items-center rounded-md border bg-background px-4 font-medium text-sm hover:bg-accent"
                >
                  {t("common.profile.ticket.upload")}
                </Label>
                <input
                  id={idArchivo}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="sr-only"
                  disabled={ocupado}
                  onChange={(event) => {
                    void subir(event.target.files?.[0]);
                    event.target.value = "";
                  }}
                />
                {data.logo.kind === "custom" && data.logoDataUrl !== null && (
                  <>
                    <img
                      src={data.logoDataUrl}
                      alt={t("common.profile.ticket.previewAlt")}
                      className="max-h-16 rounded border bg-white p-1"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      disabled={ocupado}
                      onClick={() => {
                        setError(null);
                        remove.mutate(undefined, {
                          onError: (apiError: ApiError) => setError(apiError.message),
                        });
                      }}
                    >
                      {t("common.profile.ticket.remove")}
                    </Button>
                  </>
                )}
              </div>
              <p className="text-muted-foreground text-xs">
                {t("common.profile.ticket.uploadHint")}
              </p>
            </fieldset>

            {/* ── Qué se imprime ──────────────────────────────────────── */}
            <fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
              <legend className="font-medium text-sm">
                {t("common.profile.ticket.printTitle")}
              </legend>
              {CASILLAS.map((casilla) => (
                <div key={casilla} className="flex items-center gap-3">
                  <Checkbox
                    id={`ticket-${casilla}`}
                    aria-label={t(`common.profile.ticket.${casilla}`)}
                    checked={form.casillas[casilla]}
                    disabled={ocupado}
                    onCheckedChange={(checked) =>
                      setForm({
                        ...form,
                        casillas: { ...form.casillas, [casilla]: checked === true },
                      })
                    }
                  />
                  <Label htmlFor={`ticket-${casilla}`}>
                    {t(`common.profile.ticket.${casilla}`)}
                  </Label>
                </div>
              ))}
            </fieldset>

            {/* ── El pie ──────────────────────────────────────────────── */}
            <TextField
              label={t("common.profile.ticket.footer")}
              placeholder={t("common.profile.ticket.footerPlaceholder")}
              hint={t("common.profile.ticket.footerHint")}
              maxLength={TICKET_FOOTER_MAX}
              value={form.footer}
              disabled={ocupado}
              onChange={(event) => setForm({ ...form, footer: event.target.value })}
            />

            {error && (
              <p
                role="alert"
                className="rounded-md bg-destructive/10 px-3 py-2 text-destructive text-sm"
              >
                {error}
              </p>
            )}
            {guardado && <SuccessNotice>{t("common.profile.ticket.saved")}</SuccessNotice>}
            <div>
              <Button type="submit" disabled={ocupado}>
                {update.isPending ? t("common.form.submitting") : t("common.profile.ticket.save")}
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

/** Un logotipo de la rejilla: el SVG de shared inline y `aria-pressed` con la elección. */
function LogoOpcion({
  etiqueta,
  svg,
  activo,
  disabled,
  onClick,
}: {
  etiqueta: string;
  svg?: string;
  activo: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={etiqueta}
      aria-pressed={activo}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-20 w-24 flex-col items-center justify-center gap-1 rounded-md border text-xs transition-colors ${
        activo ? "border-primary bg-primary/10 text-primary" : "hover:bg-accent"
      }`}
    >
      {svg === undefined ? (
        <span className="text-muted-foreground">—</span>
      ) : (
        // Es NUESTRO SVG, de shared, no entrada de usuario.
        // biome-ignore lint/security/noDangerouslySetInnerHtml: contenido propio y estático
        <span className="size-8" aria-hidden="true" dangerouslySetInnerHTML={{ __html: svg }} />
      )}
      <span>{etiqueta}</span>
    </button>
  );
}
