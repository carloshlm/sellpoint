import { useState } from "react";
import { useTranslation } from "react-i18next";
import { TextField } from "@/components/form/text-field";
import { Button } from "@/components/ui/button";
import type { ApiError } from "@/lib/api";
import type { Study, StudyKind } from "@/lib/medical-clinic/api";
import { useCreateStudy, useUpdateStudy } from "@/lib/medical-clinic/hooks";

/**
 * F9-CLINIC-WEB-04 — el formulario de un estudio (laboratorio o
 * diagnóstico): como el de Servicios, sin almacenes. Código y nombre de a
 * par, descripción a lo ancho, costo y precio de venta de a par.
 */
export function StudyForm({
  kind,
  study,
  onDone,
  onError,
}: {
  kind: StudyKind;
  study?: Study;
  onDone: () => void;
  onError: (message: string) => void;
}) {
  const { t } = useTranslation();
  const [code, setCode] = useState(study?.code ?? "");
  const [name, setName] = useState(study?.name ?? "");
  const [description, setDescription] = useState(study?.description ?? "");
  const [cost, setCost] = useState(study?.cost ?? "");
  const [price, setPrice] = useState(study?.price ?? "");
  const createStudy = useCreateStudy(kind);
  const updateStudy = useUpdateStudy(kind);
  const busy = createStudy.isPending || updateStudy.isPending;

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    onError("");
    const onErr = (error: ApiError) => onError(error.message);
    const numero = (v: string) => (v.trim() === "" ? undefined : Number(v));
    if (study === undefined) {
      createStudy.mutate(
        {
          code: code.trim(),
          name: name.trim(),
          ...(description.trim() !== "" && { description: description.trim() }),
          ...(numero(cost) !== undefined && { cost: numero(cost) }),
          ...(numero(price) !== undefined && { price: numero(price) }),
        },
        { onSuccess: onDone, onError: onErr },
      );
      return;
    }
    updateStudy.mutate(
      {
        id: study.id,
        input: {
          code: code.trim(),
          name: name.trim(),
          description: description.trim() === "" ? null : description.trim(),
          cost: numero(cost) ?? null,
          price: numero(price) ?? null,
        },
      },
      { onSuccess: onDone, onError: onErr },
    );
  };

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label={t("medicalClinic.studies.form.code")}
          hint={t("medicalClinic.studies.form.codeHint")}
          value={code}
          onChange={(event) => setCode(event.target.value)}
          required
        />
        <TextField
          label={t("medicalClinic.studies.form.name")}
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
        />
      </div>
      <TextField
        label={t("medicalClinic.studies.form.description")}
        value={description}
        onChange={(event) => setDescription(event.target.value)}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label={t("medicalClinic.studies.form.cost")}
          type="number"
          step="0.01"
          min="0"
          value={cost}
          onChange={(event) => setCost(event.target.value)}
        />
        <TextField
          label={t("medicalClinic.studies.form.price")}
          type="number"
          step="0.01"
          min="0"
          hint={t("medicalClinic.studies.form.priceHint")}
          value={price}
          onChange={(event) => setPrice(event.target.value)}
        />
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={busy || !code.trim() || !name.trim()}>
          {busy ? t("common.form.submitting") : t("common.form.save")}
        </Button>
        <Button type="button" variant="outline" onClick={onDone}>
          {t("common.form.cancel")}
        </Button>
      </div>
    </form>
  );
}
