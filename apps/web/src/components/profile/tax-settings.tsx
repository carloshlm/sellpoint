import type { TaxMode } from "@sellpoint/shared";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { SelectField } from "@/components/form/select-field";
import { TextField } from "@/components/form/text-field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { SuccessNotice } from "@/components/ui/success-notice";
import type { ApiError } from "@/lib/api";
import { getRegionOptions } from "@/lib/tenant/markets";
import type { TaxGroupView, UpdateTaxGroupInput } from "@/lib/tenant/tax-api";
import { useDeleteTaxGroup, useTaxSettings, useUpdateTaxSettings } from "@/lib/tenant/tax-hooks";
import type { AuthUser } from "@/stores/auth.store";

/** Un grupo en edición: el que vino del API (con `usageCount`) o uno nuevo. */
interface TasaEditable {
  /** Clave de React estable mientras se edita: los componentes no tienen id. */
  uid: string;
  code: string;
  name: string;
  rate: string;
}

interface GrupoEditable extends Omit<UpdateTaxGroupInput, "rates"> {
  rates: TasaEditable[];
  nuevo: boolean;
  usageCount: number;
}

const conUid = (r: { code: string; name: string; rate: string }): TasaEditable => ({
  uid: crypto.randomUUID(),
  ...r,
});

const TASA_VALIDA = /^\d+(\.\d{1,4})?$/;
const CODIGO_VALIDO = /^[A-Z0-9_]{1,32}$/;

const desdeVista = (g: TaxGroupView): GrupoEditable => ({
  code: g.code,
  name: g.name,
  isDefault: g.isDefault,
  isActive: g.isActive,
  rates: g.rates.map(conUid),
  nuevo: false,
  usageCount: g.usageCount,
});

/**
 * F4-TAX-14 — «Impuestos» en Mi perfil.
 *
 * Dos decisiones inmediatas (el modo y la provincia o el estado se guardan
 * al elegirlos, como los interruptores de «Datos del negocio») y un catálogo
 * que se edita y se guarda con un botón: los grupos con sus componentes, cuál
 * es el predeterminado y cuáles siguen activos. Borrar es aparte, y solo
 * procede sin artículos: el API contesta 409 con cuántos lo usan.
 *
 * La tasa se valida ANTES de mandar (hasta cuatro decimales, 0 a 100): la
 * columna redondearía callada un quinto decimal, y el 400 del API no diría
 * cuál fila.
 */
export function TaxSettings({ user }: { user: AuthUser }) {
  const { t } = useTranslation();
  const visible = user.permissions.includes("tenants:manage");
  const { data, isError } = useTaxSettings(visible);
  const update = useUpdateTaxSettings();
  const remove = useDeleteTaxGroup();
  const [grupos, setGrupos] = useState<GrupoEditable[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guardado, setGuardado] = useState(false);

  useEffect(() => {
    if (data !== undefined) {
      setGrupos(data.groups.map(desdeVista));
    }
  }, [data]);

  if (!visible) {
    return null;
  }

  const k = (sufijo: string, opciones?: Record<string, unknown>) =>
    t(`common.profile.tax.${sufijo}`, opciones);
  const ocupado = update.isPending || remove.isPending;
  const falla = (apiError: ApiError) => setError(apiError.message);

  const cambiarModo = (mode: TaxMode) => {
    setError(null);
    setGuardado(false);
    update.mutate({ mode }, { onError: falla });
  };
  const cambiarRegion = (region: string) => {
    setError(null);
    update.mutate({ region: region === "" ? null : region }, { onError: falla });
  };

  const editar = (i: number, cambios: Partial<GrupoEditable>) =>
    setGrupos((actual) => actual?.map((g, j) => (j === i ? { ...g, ...cambios } : g)) ?? null);
  const marcarDefault = (i: number) =>
    setGrupos((actual) => actual?.map((g, j) => ({ ...g, isDefault: j === i })) ?? null);
  const editarTasa = (i: number, j: number, cambios: Partial<TasaEditable>) =>
    setGrupos(
      (actual) =>
        actual?.map((g, gi) =>
          gi === i
            ? { ...g, rates: g.rates.map((r, ri) => (ri === j ? { ...r, ...cambios } : r)) }
            : g,
        ) ?? null,
    );

  const guardar = (event: React.FormEvent) => {
    event.preventDefault();
    if (grupos === null) return;
    setError(null);
    setGuardado(false);
    for (const g of grupos) {
      if (!CODIGO_VALIDO.test(g.code)) {
        setError(k("codeInvalid"));
        return;
      }
      if (g.rates.some((r) => !TASA_VALIDA.test(r.rate.trim()) || Number(r.rate) > 100)) {
        setError(k("rateInvalid"));
        return;
      }
    }
    if (grupos.filter((g) => g.isDefault && g.isActive).length !== 1) {
      setError(k("defaultRequired"));
      return;
    }
    update.mutate(
      {
        groups: grupos.map(({ nuevo: _n, usageCount: _u, ...g }) => ({
          ...g,
          code: g.code.trim().toUpperCase(),
          rates: g.rates.map(({ uid: _uid, ...r }) => ({
            ...r,
            code: r.code.trim().toUpperCase(),
            rate: r.rate.trim(),
          })),
        })),
      },
      { onSuccess: () => setGuardado(true), onError: falla },
    );
  };

  const regiones = getRegionOptions(data?.country ?? "");

  return (
    <Card data-testid="tax-settings">
      <CardHeader>
        <CardTitle>{k("title")}</CardTitle>
        <CardDescription>{k("subtitle")}</CardDescription>
      </CardHeader>
      <CardContent>
        {isError && (
          <p role="alert" className="text-destructive text-sm">
            {k("loadFailed")}
          </p>
        )}
        {data !== undefined && grupos !== null && (
          <div className="flex max-w-3xl flex-col gap-6">
            {/* ── El modo ─────────────────────────────────────────────── */}
            <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
              <legend className="font-medium text-sm">{k("modeTitle")}</legend>
              {(["included", "excluded"] as const).map((mode) => (
                <label key={mode} className="flex items-start gap-3 text-sm">
                  <input
                    type="radio"
                    name="tax-mode"
                    value={mode}
                    className="mt-1"
                    checked={data.mode === mode}
                    disabled={ocupado}
                    onChange={() => cambiarModo(mode)}
                  />
                  <span>{k(mode === "included" ? "modeIncluded" : "modeExcluded")}</span>
                </label>
              ))}
              {data.hasSales && <p className="text-muted-foreground text-xs">{k("modeWarning")}</p>}
            </fieldset>

            {/* ── La provincia o el estado ────────────────────────────── */}
            {data.needsRegion && (
              <SelectField
                label={k("region")}
                hint={k("regionHint")}
                value={data.region ?? ""}
                disabled={ocupado}
                options={[{ value: "", label: k("regionChoose") }, ...regiones]}
                onChange={(event) => cambiarRegion(event.target.value)}
              />
            )}

            {/* ── Los grupos ──────────────────────────────────────────── */}
            <form className="flex flex-col gap-4" onSubmit={guardar}>
              <div>
                <p className="font-medium text-sm">{k("groupsTitle")}</p>
                <p className="text-muted-foreground text-xs">{k("groupsHint")}</p>
              </div>
              {grupos.map((g, i) => (
                <div
                  key={g.nuevo ? `nuevo-${i}` : g.code}
                  data-testid="tax-group"
                  className="flex flex-col gap-3 rounded-lg border p-3"
                >
                  <div className="grid gap-3 sm:grid-cols-2">
                    <TextField
                      label={k("code")}
                      value={g.code}
                      disabled={ocupado || !g.nuevo}
                      onChange={(event) => editar(i, { code: event.target.value })}
                    />
                    <TextField
                      label={k("name")}
                      value={g.name}
                      disabled={ocupado}
                      onChange={(event) => editar(i, { name: event.target.value })}
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-4 text-sm">
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="tax-default"
                        checked={g.isDefault}
                        disabled={ocupado}
                        onChange={() => marcarDefault(i)}
                      />
                      {k("default")}
                    </label>
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id={`tax-active-${i}`}
                        checked={g.isActive}
                        disabled={ocupado}
                        onCheckedChange={(checked) => editar(i, { isActive: checked === true })}
                      />
                      <Label htmlFor={`tax-active-${i}`}>{k("active")}</Label>
                    </div>
                    {!g.nuevo && (
                      <span className="text-muted-foreground text-xs">
                        {k("usage", { count: g.usageCount })}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-col gap-2">
                    <p className="text-muted-foreground text-xs">{k("rates")}</p>
                    {g.rates.map((r, j) => (
                      <div
                        key={r.uid}
                        className="grid gap-2 sm:grid-cols-[1fr_2fr_1fr_auto] sm:items-end"
                      >
                        <TextField
                          label={k("rateCode")}
                          value={r.code}
                          disabled={ocupado}
                          onChange={(event) => editarTasa(i, j, { code: event.target.value })}
                        />
                        <TextField
                          label={k("rateName")}
                          value={r.name}
                          disabled={ocupado}
                          onChange={(event) => editarTasa(i, j, { name: event.target.value })}
                        />
                        <TextField
                          label={k("rate")}
                          inputMode="decimal"
                          value={r.rate}
                          disabled={ocupado}
                          onChange={(event) => editarTasa(i, j, { rate: event.target.value })}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={ocupado}
                          onClick={() => editar(i, { rates: g.rates.filter((_, ri) => ri !== j) })}
                        >
                          {k("removeRate")}
                        </Button>
                      </div>
                    ))}
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={ocupado || g.rates.length >= 4}
                        onClick={() =>
                          editar(i, {
                            rates: [...g.rates, conUid({ code: "", name: "", rate: "" })],
                          })
                        }
                      >
                        {k("addRate")}
                      </Button>
                      {!g.nuevo && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={ocupado}
                          onClick={() => {
                            setError(null);
                            setGuardado(false);
                            remove.mutate(g.code, { onError: falla });
                          }}
                        >
                          {k("remove")}
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={ocupado}
                  onClick={() =>
                    setGrupos([
                      ...grupos,
                      {
                        code: "",
                        name: "",
                        isDefault: grupos.length === 0,
                        isActive: true,
                        rates: [],
                        nuevo: true,
                        usageCount: 0,
                      },
                    ])
                  }
                >
                  {k("addGroup")}
                </Button>
                <Button type="submit" disabled={ocupado}>
                  {update.isPending ? t("common.form.submitting") : k("save")}
                </Button>
              </div>
              {error && (
                <p
                  role="alert"
                  className="rounded-md bg-destructive/10 px-3 py-2 text-destructive text-sm"
                >
                  {error}
                </p>
              )}
              {guardado && <SuccessNotice>{k("saved")}</SuccessNotice>}
            </form>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
