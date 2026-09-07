import { isRealCalendarDate } from "@sellpoint/shared";
import { useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
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
 * Compone `YYYY-MM-DD` en cuanto las tres partes están, **sin juzgar si la
 * fecha existe**. Que el 31 de febrero suba es a propósito: devolver "" acá
 * significaba «sin fecha», y el formulario guardaba al paciente sin fecha de
 * nacimiento sin decir una palabra. Ahora sube tal cual y el schema la marca
 * con un error que se ve. El silencio es peor que el error.
 *
 * Incompleta sí devuelve vacío: mientras falta una parte todavía no hay nada
 * que juzgar.
 */
function componer(dia: string, mes: string, anio: string): string {
  if (dia === "" || mes === "" || anio.length !== 4) return "";
  const d = Number(dia);
  const m = Number(mes);
  const a = Number(anio);
  if (!Number.isInteger(d) || !Number.isInteger(m) || !Number.isInteger(a)) return "";

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

  /**
   * La fecha tecleada, en palabras. Es lo que reemplaza al nombre del mes de
   * la lista: «17 de marzo de 1985» confirma de un vistazo que 3 era marzo y
   * no abril, sin costarle una interacción a nadie.
   */
  const enPalabras = useMemo(() => {
    // Una fecha imposible no se confirma: no existe un «31 de febrero».
    if (value === "" || !isRealCalendarDate(value)) return "";
    return new Intl.DateTimeFormat(i18n.language, { dateStyle: "long", timeZone: "UTC" }).format(
      new Date(`${value}T12:00:00Z`),
    );
  }, [value, i18n.language]);

  const cambiar = (parte: "dia" | "mes" | "anio", crudo: string) => {
    const limpio = crudo.replace(/\D/g, "");
    const siguiente = { dia, mes, anio, [parte]: limpio };
    setPartes(siguiente);
    const compuesto = componer(siguiente.dia, siguiente.mes, siguiente.anio);
    setValorPrevio(compuesto);
    onChange(compuesto);
  };

  const describedBy =
    [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ") || undefined;
  const invalido = error ? true : undefined;

  return (
    <fieldset className={cn("flex flex-col gap-2", className)} aria-describedby={describedBy}>
      {/* Las MISMAS clases que `Label` (incluido `leading-none`) y el mismo
          `mb` que el `gap-2` del resto: sin eso el input quedaba 6 px más abajo
          que el de la celda de al lado. */}
      <legend className="mb-2 flex select-none items-center font-medium text-sm leading-none">
        {label}
      </legend>
      {/* Ancho acotado: el mes no necesita estirarse a media pantalla, y en el
          celular las tres columnas siguen entrando cómodas. */}
      {/* Sin etiqueta propia por campo: esa línea de más empujaba los inputs
          26 px hacia abajo y rompía la retícula de dos columnas del form. El
          nombre de cada parte vive en su `aria-label`, y el formato lo dice el
          texto de abajo. */}
      <div className="flex gap-2">
        <Input
          id={`${id}-d`}
          aria-label={t("common.birthDate.day")}
          // `text` y no `number`: en el celular `number` deja pegar letras y
          // trae flechitas que nadie usa. `inputMode` es lo que abre el
          // teclado numérico de verdad.
          type="text"
          inputMode="numeric"
          maxLength={2}
          className="w-16"
          autoComplete="bday-day"
          placeholder="31"
          aria-invalid={invalido}
          value={dia}
          onChange={(e) => cambiar("dia", e.target.value)}
        />
        <Input
          id={`${id}-m`}
          aria-label={t("common.birthDate.month")}
          type="text"
          inputMode="numeric"
          maxLength={2}
          className="w-16"
          autoComplete="bday-month"
          placeholder="3"
          aria-invalid={invalido}
          value={mes}
          onChange={(e) => cambiar("mes", e.target.value)}
        />
        <Input
          id={`${id}-a`}
          aria-label={t("common.birthDate.year")}
          type="text"
          inputMode="numeric"
          maxLength={4}
          className="w-24"
          autoComplete="bday-year"
          placeholder="1990"
          aria-invalid={invalido}
          value={anio}
          onChange={(e) => cambiar("anio", e.target.value)}
        />
      </div>
      {!error && (
        <p id={hintId} aria-live="polite" className="text-muted-foreground text-xs">
          {[enPalabras || t("common.birthDate.format"), hint].filter(Boolean).join(" · ")}
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
