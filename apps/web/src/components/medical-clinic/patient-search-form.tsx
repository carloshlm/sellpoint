import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { TextField } from "@/components/form/text-field";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

export type SearchMode = "name" | "turn";

/**
 * F9-CLINIC-WEB-07 — buscar al paciente por nombre o por turno de hoy. UN
 * solo campo que cambia de etiqueta y tipo con el modo; cambiar de modo lo
 * vacía (un nombre no es un número de turno). Radios nativos: dos opciones
 * no ameritan un componente.
 */
export function PatientSearchForm({
  busy,
  onSearch,
}: {
  busy: boolean;
  onSearch: (params: { mode: SearchMode; q: string }) => void;
}) {
  const { t } = useTranslation();
  const grupo = useId();
  const [mode, setMode] = useState<SearchMode>("name");
  const [q, setQ] = useState("");

  const cambiarModo = (siguiente: SearchMode) => {
    setMode(siguiente);
    setQ("");
  };

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (q.trim() === "") return;
        onSearch({ mode, q: q.trim() });
      }}
    >
      <fieldset className="flex flex-col gap-2">
        <legend className="font-medium text-sm">{t("medicalClinic.attend.searchBy")}</legend>
        <div className="flex gap-4">
          {(["name", "turn"] as const).map((opcion) => (
            <div key={opcion} className="flex items-center gap-2">
              <input
                type="radio"
                id={`${grupo}-${opcion}`}
                name={`${grupo}-mode`}
                value={opcion}
                checked={mode === opcion}
                onChange={() => cambiarModo(opcion)}
                className="size-4 accent-primary"
              />
              <Label htmlFor={`${grupo}-${opcion}`}>
                {t(
                  opcion === "name" ? "medicalClinic.attend.byName" : "medicalClinic.attend.byTurn",
                )}
              </Label>
            </div>
          ))}
        </div>
      </fieldset>

      {mode === "name" ? (
        <TextField
          key="name"
          label={t("medicalClinic.attend.nameLabel")}
          value={q}
          onChange={(event) => setQ(event.target.value)}
          autoFocus
        />
      ) : (
        <TextField
          key="turn"
          label={t("medicalClinic.attend.turnLabel")}
          hint={t("medicalClinic.attend.turnHint")}
          type="number"
          inputMode="numeric"
          min={1}
          step={1}
          value={q}
          // `type=number` todavía deja pasar «e», «+» y «.» en varios navegadores.
          onChange={(event) => setQ(event.target.value.replace(/\D/g, ""))}
          autoFocus
        />
      )}

      <div>
        <Button type="submit" disabled={busy || q.trim() === ""}>
          {t("medicalClinic.attend.search")}
        </Button>
      </div>
    </form>
  );
}
