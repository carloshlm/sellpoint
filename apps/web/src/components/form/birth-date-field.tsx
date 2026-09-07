import { useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface BirthDateFieldProps {
  label: string;
  /** `YYYY-MM-DD`, o cadena vacía cuando falta alguna parte. */
  value: string;
  onChange: (value: string) => void;
  /** Mensaje YA traducido. */
  error?: string;
  hint?: string;
  className?: string;
}

/** Las tres partes de lo que llega guardado; vacías si el valor no está completo. */
function partesDe(value: string): { dia: string; mes: string; anio: string } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return { dia: "", mes: "", anio: "" };
  return { anio: m[1] as string, mes: String(Number(m[2])), dia: String(Number(m[3])) };
}

/**
 * Compone `YYYY-MM-DD` solo si las tres partes existen Y la fecha EXISTE: el 31
 * de febrero se descarta acá, no en el submit. Cualquier otra cosa devuelve
 * vacío — antes que adivinar una fecha, ninguna.
 */
function componer(dia: string, mes: string, anio: string): string {
  if (dia === "" || mes === "" || anio.length !== 4) return "";
  const d = Number(dia);
  const m = Number(mes);
  const a = Number(anio);
  if (!Number.isInteger(d) || !Number.isInteger(m) || !Number.isInteger(a)) return "";
  // `new Date` normaliza en silencio (el 31/2 se vuelve 3/3): se compara de
  // vuelta para cazar justo eso.
  const fecha = new Date(Date.UTC(a, m - 1, d));
  if (fecha.getUTCFullYear() !== a || fecha.getUTCMonth() !== m - 1 || fecha.getUTCDate() !== d) {
    return "";
  }

  return `${String(a).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * La fecha de nacimiento, en tres campos en vez de un calendario.
 *
 * El `<input type="date">` nativo abre en el MES ACTUAL: para llegar a 1985 hay
 * que retroceder cientos de clics, y en el celular el selector de rueda es
 * todavía peor. Tres campos se teclean de corrido —día, mes, año— y en el
 * teléfono abren el teclado numérico. El mes es una LISTA y no un número: así
 * `03/04` deja de significar dos fechas distintas según de dónde sea quien lo
 * lee.
 *
 * Presentacional y controlado, como `PhonePartsField`: se PINTA en tres partes
 * y se guarda como UN `YYYY-MM-DD`. Mientras falte una parte —o la fecha no
 * exista— el valor es cadena vacía, que es exactamente lo que el contenedor ya
 * trataba como «sin fecha».
 */
function BirthDateField({ label, value, onChange, error, hint, className }: BirthDateFieldProps) {
  const { i18n } = useTranslation();
  const { t } = useTranslation();
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  // Las tres partes viven ACÁ y no derivadas de `value`: mientras la fecha
  // está incompleta el valor es "", así que derivarlo borraría lo ya tecleado
  // en el render siguiente. Se re-sincroniza cuando el contenedor cambia el
  // valor por su cuenta (carga tardía de la ficha, reset del form) — patrón
  // de «ajustar estado al cambiar props», sin efecto.
  const [partes, setPartes] = useState(() => partesDe(value));
  const [valorPrevio, setValorPrevio] = useState(value);
  if (value !== valorPrevio) {
    setValorPrevio(value);
    if (value !== componer(partes.dia, partes.mes, partes.anio)) {
      setPartes(partesDe(value));
    }
  }
  const { dia, mes, anio } = partes;

  const meses = useMemo(() => {
    const nombre = new Intl.DateTimeFormat(i18n.language, { month: "long", timeZone: "UTC" });
    return Array.from({ length: 12 }, (_, i) => ({
      value: String(i + 1),
      label: nombre.format(new Date(Date.UTC(2000, i, 1))),
    }));
  }, [i18n.language]);

  const cambiar = (parte: "dia" | "mes" | "anio", crudo: string) => {
    const limpio = parte === "mes" ? crudo : crudo.replace(/\D/g, "");
    const siguiente = { dia, mes, anio, [parte]: limpio };
    setPartes(siguiente);
    const compuesto = componer(siguiente.dia, siguiente.mes, siguiente.anio);
    setValorPrevio(compuesto);
    onChange(compuesto);
  };

  const describedBy =
    [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ") || undefined;
  const invalido = error ? true : undefined;
  const campo = "h-9 rounded-md border border-input bg-background px-2 text-sm";

  return (
    <fieldset className={cn("flex flex-col gap-2", className)} aria-describedby={describedBy}>
      <legend className="mb-2 font-medium text-sm">{label}</legend>
      {/* Ancho acotado: el mes no necesita estirarse a media pantalla, y en el
          celular las tres columnas siguen entrando cómodas. */}
      <div className="grid max-w-sm grid-cols-[4rem_minmax(0,1fr)_5rem] gap-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${id}-d`} className="text-muted-foreground text-xs">
            {t("common.birthDate.day")}
          </Label>
          <Input
            id={`${id}-d`}
            // `text` y no `number`: en el celular `number` deja pegar letras y
            // trae flechitas que nadie usa. `inputMode` es lo que abre el
            // teclado numérico de verdad.
            type="text"
            inputMode="numeric"
            maxLength={2}
            autoComplete="bday-day"
            placeholder="31"
            aria-invalid={invalido}
            value={dia}
            onChange={(e) => cambiar("dia", e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${id}-m`} className="text-muted-foreground text-xs">
            {t("common.birthDate.month")}
          </Label>
          <select
            id={`${id}-m`}
            className={campo}
            autoComplete="bday-month"
            aria-invalid={invalido}
            value={mes}
            onChange={(e) => cambiar("mes", e.target.value)}
          >
            <option value="">{t("common.birthDate.monthPlaceholder")}</option>
            {meses.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${id}-a`} className="text-muted-foreground text-xs">
            {t("common.birthDate.year")}
          </Label>
          <Input
            id={`${id}-a`}
            type="text"
            inputMode="numeric"
            maxLength={4}
            autoComplete="bday-year"
            placeholder="1990"
            aria-invalid={invalido}
            value={anio}
            onChange={(e) => cambiar("anio", e.target.value)}
          />
        </div>
      </div>
      {hint && !error && (
        <p id={hintId} aria-live="polite" className="text-muted-foreground text-xs">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-destructive text-xs">
          {error}
        </p>
      )}
    </fieldset>
  );
}

export { BirthDateField };
