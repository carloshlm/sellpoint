/**
 * F9-CLINIC-WEB-16 — lo que la tarjeta completada dice en una línea.
 *
 * Solo las secciones con formulario tienen resumen; el resto devuelve null y
 * la tarjeta no pinta nada. `t` llega de afuera para que esto siga siendo una
 * función pura testeable sin i18n.
 */
import { bmi } from "@sellpoint/shared";
import { allergiesLine } from "./allergies";

const MAX = 80;

function recorte(texto: string): string {
  const limpio = texto.trim();
  if (limpio.length <= MAX) return limpio;
  const trozo = limpio.slice(0, MAX);
  const espacio = trozo.lastIndexOf(" ");
  return `${(espacio > 0 ? trozo.slice(0, espacio) : trozo).trimEnd()}…`;
}

function texto(valor: unknown): string | null {
  return typeof valor === "string" && valor.trim() !== "" ? valor : null;
}

export function summaryOf(
  key: string,
  data: Record<string, unknown> | null | undefined,
  t: (key: string, options?: Record<string, unknown>) => string,
): string | null {
  if (!data) return null;
  switch (key) {
    case "general_data": {
      const sex = texto(data.sex);
      const partes = [
        sex ? t(`medicalClinic.forms.generalData.sexOptions.${sex}`) : null,
        texto(data.occupation),
      ].filter((p): p is string => p !== null);
      return partes.length > 0 ? partes.join(" · ") : null;
    }
    case "chief_complaint": {
      const complaint = texto(data.complaint);
      return complaint ? recorte(complaint) : null;
    }
    case "current_illness": {
      const narrative = texto(data.narrative);
      return narrative ? recorte(narrative) : null;
    }
    case "family_history": {
      if (data.negated === true) return t("medicalClinic.forms.familyHistory.negated");
      const conditions = Array.isArray(data.conditions)
        ? (data.conditions as Record<string, unknown>[])
        : [];
      const partes = conditions.flatMap((c) => {
        const condition = texto(c.condition);
        const relatives = Array.isArray(c.relatives) ? (c.relatives as string[]) : [];
        if (!condition || relatives.length === 0) return [];
        const nombre =
          condition === "other" && texto(c.otherLabel)
            ? (c.otherLabel as string)
            : t(`medicalClinic.forms.familyHistory.conditions.${condition}`);
        return [
          `${nombre}: ${relatives.map((r) => t(`medicalClinic.forms.familyHistory.relatives.${r}`)).join(", ")}`,
        ];
      });
      return partes.length > 0 ? recorte(partes.join(" · ")) : null;
    }
    case "pathological_history": {
      if (data.negated === true) return t("medicalClinic.forms.pathologicalHistory.negated");
      const partes: string[] = [];
      for (const c of Array.isArray(data.chronic)
        ? (data.chronic as Record<string, unknown>[])
        : []) {
        const condition = texto(c.condition);
        if (!condition) continue;
        const nombre =
          condition === "other" && texto(c.otherLabel)
            ? (c.otherLabel as string)
            : t(`medicalClinic.forms.pathologicalHistory.chronicOptions.${condition}`);
        partes.push(typeof c.sinceYear === "number" ? `${nombre} (${c.sinceYear})` : nombre);
      }
      for (const s of Array.isArray(data.surgeries)
        ? (data.surgeries as Record<string, unknown>[])
        : []) {
        const procedure = texto(s.procedure);
        if (procedure)
          partes.push(typeof s.year === "number" ? `${procedure} ${s.year}` : procedure);
      }
      const resto =
        (Array.isArray(data.childhood) ? data.childhood.length : 0) +
        (Array.isArray(data.traumas) ? data.traumas.length : 0) +
        (Array.isArray(data.hospitalizations) ? data.hospitalizations.length : 0) +
        (Array.isArray(data.infectious) ? data.infectious.length : 0) +
        (typeof data.transfusions === "object" && data.transfusions !== null ? 1 : 0);
      if (partes.length === 0 && resto === 0) return null;
      const linea = partes.join(" · ");
      return recorte(resto > 0 ? (linea ? `${linea} · +${resto}` : `+${resto}`) : linea);
    }
    case "non_pathological_history": {
      const partes: string[] = [];
      const smoking = data.smoking as Record<string, unknown> | undefined;
      if (smoking && typeof smoking === "object" && texto(smoking.status)) {
        const status = smoking.status as string;
        partes.push(
          status === "current" && typeof smoking.cigarettesPerDay === "number"
            ? t("medicalClinic.forms.nonPathologicalHistory.summarySmokes", {
                count: smoking.cigarettesPerDay,
              })
            : t(`medicalClinic.forms.nonPathologicalHistory.smokingOptions.${status}`),
        );
      }
      const alcohol = data.alcohol as Record<string, unknown> | undefined;
      if (alcohol && typeof alcohol === "object" && texto(alcohol.status)) {
        partes.push(
          t(
            `medicalClinic.forms.nonPathologicalHistory.alcoholOptions.${alcohol.status as string}`,
          ),
        );
      }
      const bloodType = texto(data.bloodType);
      if (bloodType) {
        partes.push(
          bloodType === "unknown"
            ? t("medicalClinic.forms.nonPathologicalHistory.bloodTypeUnknown")
            : bloodType,
        );
      }
      const immunizations = texto(data.immunizations);
      if (immunizations) {
        partes.push(
          t(`medicalClinic.forms.nonPathologicalHistory.immunizationOptions.${immunizations}`),
        );
      }
      return partes.length > 0 ? recorte(partes.join(" · ")) : null;
    }
    case "gyneco_obstetric_history": {
      const partes: string[] = [];
      const gpac = ["gestations", "births", "abortions", "cesareans"]
        .map((c, i) => (typeof data[c] === "number" ? `${"GPAC"[i]}${data[c]}` : null))
        .filter((p): p is string => p !== null);
      if (gpac.length > 0) partes.push(gpac.join(" "));
      const fum = texto(data.lastPeriodDate);
      if (fum) partes.push(`${t("medicalClinic.forms.gynecoObstetric.summaryLastPeriod")} ${fum}`);
      const mpf = texto(data.contraception);
      if (mpf) partes.push(t(`medicalClinic.forms.gynecoObstetric.contraceptionOptions.${mpf}`));
      if (data.pregnant === true) partes.push(t("medicalClinic.forms.gynecoObstetric.pregnant"));
      return partes.length > 0 ? recorte(partes.join(" · ")) : null;
    }
    case "allergies": {
      const linea = allergiesLine(data, t);
      return linea ? recorte(linea.text) : null;
    }
    case "current_medications": {
      if (data.none === true) return t("medicalClinic.forms.currentMedications.none");
      const items = Array.isArray(data.items) ? (data.items as Record<string, unknown>[]) : [];
      const nombres = items.flatMap((m) => {
        const name = texto(m.name);
        if (!name) return [];
        const dose = texto(m.dose);
        return [dose ? `${name} ${dose}` : name];
      });
      return nombres.length > 0 ? recorte(nombres.join(" · ")) : null;
    }
    case "systems_review": {
      if (data.negated === true) return t("medicalClinic.forms.systemsReview.negated");
      const systems =
        typeof data.systems === "object" && data.systems !== null
          ? (data.systems as Record<string, Record<string, unknown>>)
          : {};
      const negados = Object.values(systems).filter((s) => s?.normal === true).length;
      const hallazgos = Object.entries(systems).flatMap(([key, s]) => {
        const findings = texto(s?.findings);
        return findings
          ? [`${t(`medicalClinic.forms.systemsReview.systems.${key}`)}: ${findings}`]
          : [];
      });
      const partes = [
        ...(negados > 0
          ? [t("medicalClinic.forms.systemsReview.summaryNegated", { count: negados })]
          : []),
        ...hallazgos,
      ];
      return partes.length > 0 ? recorte(partes.join(" · ")) : null;
    }
    case "anthropometry": {
      const peso = typeof data.weightKg === "number" ? data.weightKg : null;
      const talla = typeof data.heightCm === "number" ? data.heightCm : null;
      const partes = [
        peso !== null ? `${peso} kg` : null,
        talla !== null ? `${talla} cm` : null,
      ].filter((p): p is string => p !== null);
      const imc = bmi(peso, talla);
      if (imc !== null) partes.push(`IMC ${imc.toFixed(1)}`);
      return partes.length > 0 ? partes.join(" · ") : null;
    }
    case "vital_signs": {
      const partes: string[] = [];
      if (typeof data.systolic === "number" || typeof data.diastolic === "number") {
        partes.push(`TA ${data.systolic ?? "—"}/${data.diastolic ?? "—"}`);
      }
      if (typeof data.heartRate === "number") partes.push(`FC ${data.heartRate}`);
      if (typeof data.respiratoryRate === "number") partes.push(`FR ${data.respiratoryRate}`);
      if (typeof data.temperatureC === "number") partes.push(`T ${data.temperatureC}`);
      if (typeof data.oxygenSaturation === "number") partes.push(`SpO2 ${data.oxygenSaturation}`);
      return partes.length > 0 ? recorte(partes.join(" · ")) : null;
    }
    case "physical_exam": {
      const regions =
        typeof data.regions === "object" && data.regions !== null
          ? (data.regions as Record<string, Record<string, unknown>>)
          : {};
      const normales = Object.values(regions).filter((r) => r?.normal === true).length;
      const hallazgos = Object.entries(regions).flatMap(([key, r]) => {
        const findings = texto(r?.findings);
        return findings
          ? [`${t(`medicalClinic.forms.physicalExam.regions.${key}`)}: ${findings}`]
          : [];
      });
      const partes = [
        ...(normales > 0
          ? [t("medicalClinic.forms.physicalExam.summaryNormal", { count: normales })]
          : []),
        ...hallazgos,
      ];
      if (partes.length === 0) {
        const habitus = texto(data.habitus);
        return habitus ? recorte(habitus) : null;
      }
      return recorte(partes.join(" · "));
    }
    case "study_results": {
      const items = Array.isArray(data.items) ? (data.items as Record<string, unknown>[]) : [];
      if (items.length === 0) return null;
      const primero = items[0] as Record<string, unknown>;
      const nombre = texto(primero.name);
      const detalle = [nombre, texto(primero.date)].filter(Boolean).join(" ");
      const interpretacion = texto(primero.interpretation);
      const cabeza = interpretacion
        ? `${detalle} (${t(`medicalClinic.forms.studyResults.interpretationOptions.${interpretacion}`)})`
        : detalle;
      return recorte(
        `${t("medicalClinic.forms.studyResults.summaryCount", { count: items.length })} · ${cabeza}`,
      );
    }
    case "diagnostic_impression": {
      const impression = texto(data.impression);
      return impression ? recorte(impression) : null;
    }
    case "diagnoses": {
      const items = Array.isArray(data.items) ? (data.items as Record<string, unknown>[]) : [];
      const principal = items.find((i) => i.role === "primary") ?? items[0];
      if (!principal || !texto(principal.description)) return null;
      const code = texto(principal.icd10Code);
      const linea = code ? `${code} ${principal.description}` : (principal.description as string);
      return recorte(items.length > 1 ? `${linea} (+${items.length - 1})` : linea);
    }
    case "treatment": {
      const elegido =
        texto(data.pharmacological) ?? texto(data.nonPharmacological) ?? texto(data.procedures);
      return elegido ? recorte(elegido) : null;
    }
    case "management_plan": {
      const partes: string[] = [];
      const prognosis = texto(data.prognosis);
      if (prognosis) {
        partes.push(
          `${t("medicalClinic.forms.managementPlan.summaryPrognosis")}: ${t(`medicalClinic.forms.managementPlan.prognosisOptions.${prognosis}`)}`,
        );
      }
      const plan = texto(data.plan);
      if (plan) partes.push(plan);
      return partes.length > 0 ? recorte(partes.join(" · ")) : null;
    }
    case "follow_up": {
      const partes: string[] = [];
      const cita = texto(data.nextAppointmentDate);
      if (cita) partes.push(`${t("medicalClinic.forms.followUp.summaryAppointment")} ${cita}`);
      const alarma = texto(data.alarmSigns);
      if (alarma) partes.push(`${t("medicalClinic.forms.followUp.summaryAlarm")}: ${alarma}`);
      const recomendaciones = texto(data.recommendations);
      if (partes.length === 0 && recomendaciones) partes.push(recomendaciones);
      return partes.length > 0 ? recorte(partes.join(" · ")) : null;
    }
    case "medical_notes": {
      // F9-CLINIC-DOC-02: cuántas y la última («3 notas · 18:40 Evolución: …»).
      const items = Array.isArray(data.items) ? (data.items as Record<string, unknown>[]) : [];
      if (items.length === 0) return null;
      const ultima = items[items.length - 1] as Record<string, unknown>;
      const tipo = texto(ultima.kind)
        ? t(`medicalClinic.forms.medicalNotes.kinds.${ultima.kind as string}`)
        : null;
      const cabeza = [texto(ultima.time), tipo].filter(Boolean).join(" ");
      const cuerpo = texto(ultima.text);
      return recorte(
        `${t("medicalClinic.forms.medicalNotes.summaryCount", { count: items.length })} · ${cabeza}${cuerpo ? `: ${cuerpo}` : ""}`,
      );
    }
    default:
      return null;
  }
}
