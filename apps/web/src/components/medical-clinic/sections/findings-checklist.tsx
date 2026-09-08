import { useId } from "react";
import { TextAreaField } from "@/components/form/text-area-field";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";

/** Lo que un ítem puede valer: normal explícito, o hallazgos con texto. */
export type FindingValue = { normal: true } | { findings: string };
export type FindingsValue = Partial<Record<string, FindingValue>>;

export interface FindingsItem {
  key: string;
  label: string;
  /** Los síntomas o signos cardinales, para guiar sin obligar. */
  hint?: string;
}

interface FindingsChecklistProps {
  items: readonly FindingsItem[];
  value: FindingsValue;
  onChange: (value: FindingsValue) => void;
  /** «Todos negados» / «Todo sin alteraciones». */
  allNormalLabel: string;
  /** «Interrogado y negado» / «Sin alteraciones». */
  normalLabel: string;
  /** «Con síntomas» / «Con hallazgos». */
  findingsLabel: string;
  findingsPlaceholder?: string;
  disabled?: boolean;
}

/**
 * Lo que viaja al API: ítems normales tal cual, hallazgos solo con texto.
 * Un «Con hallazgos» sin escribir nada no es un hallazgo: se omite.
 */
export function cleanFindings(value: FindingsValue): FindingsValue {
  const limpio: FindingsValue = {};
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined) continue;
    if ("normal" in item) limpio[key] = { normal: true };
    else if (item.findings.trim() !== "") limpio[key] = { findings: item.findings.trim() };
  }
  return limpio;
}

const ITEM_CLASS =
  "inline-flex h-8 items-center rounded-md border px-3 text-sm transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50";

/**
 * F9-CLINIC-HC-04 — un checklist de aparatos, sistemas o regiones: cada
 * ítem es «normal» o «con hallazgos», y solo lo segundo pide texto. El botón
 * de arriba pone todo en normal de una vez; después el médico corrige solo
 * lo que encontró. Lo no tocado no viaja.
 */
export function FindingsChecklist({
  items,
  value,
  onChange,
  allNormalLabel,
  normalLabel,
  findingsLabel,
  findingsPlaceholder,
  disabled = false,
}: FindingsChecklistProps) {
  const id = useId();
  const poner = (key: string, item: FindingValue | undefined) => {
    const siguiente = { ...value };
    if (item === undefined) delete siguiente[key];
    else siguiente[key] = item;
    onChange(siguiente);
  };
  const todoNormal = () =>
    onChange(Object.fromEntries(items.map((item) => [item.key, { normal: true }])));

  return (
    <div className="flex flex-col gap-3">
      <Button
        type="button"
        variant="outline"
        className="w-fit"
        disabled={disabled}
        onClick={todoNormal}
      >
        {allNormalLabel}
      </Button>
      <ul className="flex flex-col divide-y">
        {items.map((item) => {
          const actual = value[item.key];
          const estado = actual === undefined ? "" : "normal" in actual ? "normal" : "findings";
          const labelId = `${id}-${item.key}`;
          return (
            <li key={item.key} className="flex flex-col gap-2 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 flex-col">
                  <span id={labelId} className="font-medium text-sm">
                    {item.label}
                  </span>
                  {item.hint ? (
                    <span className="text-muted-foreground text-xs">{item.hint}</span>
                  ) : null}
                </div>
                <RadioGroup
                  aria-labelledby={labelId}
                  className="flex gap-2"
                  value={estado}
                  disabled={disabled}
                  onValueChange={(next) =>
                    poner(
                      item.key,
                      next === "normal"
                        ? { normal: true }
                        : {
                            findings:
                              actual !== undefined && "findings" in actual ? actual.findings : "",
                          },
                    )
                  }
                >
                  <RadioGroupItem value="normal" className={cn(ITEM_CLASS)}>
                    {normalLabel}
                  </RadioGroupItem>
                  <RadioGroupItem value="findings" className={cn(ITEM_CLASS)}>
                    {findingsLabel}
                  </RadioGroupItem>
                </RadioGroup>
              </div>
              {estado === "findings" && actual !== undefined && "findings" in actual ? (
                <TextAreaField
                  label={`${findingsLabel}: ${item.label}`}
                  rows={2}
                  placeholder={findingsPlaceholder}
                  value={actual.findings}
                  disabled={disabled}
                  maxLength={1000}
                  onChange={(event) => poner(item.key, { findings: event.target.value })}
                />
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
