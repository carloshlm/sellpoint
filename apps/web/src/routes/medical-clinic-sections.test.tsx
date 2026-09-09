import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@/i18n";
import * as clinicApi from "@/lib/medical-clinic/api";
import { createQueryClient } from "@/lib/query-client";
import { routeTree } from "@/routeTree.gen";
import { useAuthStore } from "@/stores/auth.store";
import { clinicUser, expediente } from "@/test/medical-clinic-fixture";

/**
 * F9-CLINIC-WEB-13/14/15 — la ruta de sección: registro de formularios,
 * redirección si la clave no es funcional, y los tres formularios que
 * guardan SOLO lo capturado y vuelven al tablero.
 */
vi.mock("@/lib/medical-clinic/api", () => ({
  getRecord: vi.fn(),
  closeRecord: vi.fn(),
  saveSection: vi.fn(),
}));
const mocked = vi.mocked(clinicApi);

async function renderSection(key: string, record = expediente()) {
  mocked.getRecord.mockResolvedValue(record);
  useAuthStore
    .getState()
    .setAuth("jwt-demo", clinicUser(["medical_clinic:read", "medical_clinic:attend"]));
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({
      initialEntries: [`/medical-clinic/records/r1/sections/${key}`],
    }),
  });
  await router.load();
  render(
    <I18nextProvider i18n={createI18n()}>
      <QueryClientProvider client={createQueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </I18nextProvider>,
  );
  return router;
}

beforeEach(() => {
  mocked.saveSection.mockImplementation((_id, key, data) =>
    Promise.resolve({
      key,
      status: Object.keys(data).length ? "completed" : "pending",
      data,
      updatedAt: null,
    }),
  );
});

afterEach(() => {
  useAuthStore.getState().clearAuth();
  vi.clearAllMocks();
});

describe("ruta de sección (F9-CLINIC-WEB-13)", () => {
  it("una clave sin formulario o desconocida redirige al tablero", async () => {
    const router = await renderSection("attachments");
    await waitFor(() => expect(router.state.location.pathname).toBe("/medical-clinic/records/r1"));
    const otro = await renderSection("no_existe");
    await waitFor(() => expect(otro.state.location.pathname).toBe("/medical-clinic/records/r1"));
  });

  it("Datos Generales pinta el h1 en la tarjeta; Cancelar vuelve sin guardar", async () => {
    const router = await renderSection("general_data");
    const titulo = await screen.findByRole("heading", { level: 1, name: "Datos Generales" });
    expect(titulo.closest('[data-slot="card"]')).not.toBeNull();
    expect(screen.getByRole("link", { name: "← Historia clínica HCL-000010" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/medical-clinic/records/r1"));
    expect(mocked.saveSection).not.toHaveBeenCalled();
  });

  it("con la consulta cerrada el formulario es de solo lectura", async () => {
    await renderSection(
      "general_data",
      expediente({ status: "closed", closedAt: "2026-09-03T19:00:00.000Z" }),
    );
    expect(
      await screen.findByText("La consulta está cerrada: esta sección es de solo lectura."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Guardar" })).not.toBeInTheDocument();
  });
});

describe("Datos Generales (F9-CLINIC-WEB-14)", () => {
  it("guarda solo lo capturado y vuelve al tablero", async () => {
    const router = await renderSection("general_data");
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText("Sexo"), "F");
    await user.type(screen.getByLabelText("Ocupación"), "Docente");
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(mocked.saveSection).toHaveBeenCalledWith("r1", "general_data", {
        sex: "F",
        occupation: "Docente",
      }),
    );
    await waitFor(() => expect(router.state.location.pathname).toBe("/medical-clinic/records/r1"));
  });

  it("todo vacío manda un objeto sin claves", async () => {
    await renderSection("general_data");
    await userEvent.click(await screen.findByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(mocked.saveSection).toHaveBeenCalledWith("r1", "general_data", {}));
  });

  it("un teléfono inválido muestra el error y no envía", async () => {
    await renderSection("general_data");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Teléfono del contacto"), "abc");
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(mocked.saveSection).not.toHaveBeenCalled();
  });

  it("precarga lo ya guardado", async () => {
    await renderSection(
      "general_data",
      expediente({}, { general_data: { sex: "M", occupation: "Chofer" } }),
    );
    expect(await screen.findByLabelText("Sexo")).toHaveValue("M");
    expect(screen.getByLabelText("Ocupación")).toHaveValue("Chofer");
  });
});

describe("Motivo y Padecimiento (F9-CLINIC-WEB-15)", () => {
  it("el motivo guarda complaint, onsetValue y onsetUnit", async () => {
    await renderSection("chief_complaint");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Motivo de consulta"), "Dolor de garganta");
    await user.type(screen.getByLabelText("Tiempo de evolución"), "3");
    await user.selectOptions(screen.getByLabelText("Unidad"), "days");
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(mocked.saveSection).toHaveBeenCalledWith("r1", "chief_complaint", {
        complaint: "Dolor de garganta",
        onsetValue: 3,
        onsetUnit: "days",
      }),
    );
  });

  it("el padecimiento no acepta fecha futura y sin fecha no manda startDate", async () => {
    await renderSection("current_illness");
    const user = userEvent.setup();
    const fecha = await screen.findByLabelText("Fecha de inicio");
    expect(fecha).toHaveAttribute("max");
    expect(fecha.getAttribute("max")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await user.type(screen.getByLabelText("Padecimiento actual"), "Inicia hace 3 días…");
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(mocked.saveSection).toHaveBeenCalledWith("r1", "current_illness", {
        narrative: "Inicia hace 3 días…",
      }),
    );
  });
});

/** F9-CLINIC-WEB-24 — la sección de una consulta vencida es de solo lectura. */
describe("sección de una consulta vencida", () => {
  it("avisa que es de otro día y no ofrece Guardar", async () => {
    await renderSection(
      "general_data",
      expediente({ status: "open", editable: false, lockReason: "expired" }),
    );
    expect(
      await screen.findByText("Esta consulta es de otro día: esta sección es de solo lectura."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Guardar" })).not.toBeInTheDocument();
  });

  it("si el día cambia mientras se captura, el error no borra lo tecleado", async () => {
    mocked.saveSection.mockRejectedValue({
      statusCode: 409,
      code: "medical_clinic.record_expired",
      message: "Esa consulta es de otro día: ya no se puede capturar. Abre una consulta nueva.",
    });
    await renderSection("chief_complaint");
    const user = userEvent.setup();
    const motivo = await screen.findByLabelText("Motivo de consulta");
    await user.type(motivo, "Dolor de garganta");
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Esa consulta es de otro día: ya no se puede capturar. Abre una consulta nueva.",
    );
    expect(motivo).toHaveValue("Dolor de garganta");
  });
});

/**
 * F9-CLINIC-HC-06 — AHF: enfermedad × parentesco. Lo negado viaja explícito;
 * una enfermedad sin parentesco no viaja.
 */
describe("Antecedentes Heredofamiliares (F9-CLINIC-HC-06)", () => {
  it("marcar Diabetes y Madre guarda la enfermedad con su parentesco, en el orden del catálogo", async () => {
    await renderSection("family_history");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("checkbox", { name: "Diabetes" }));
    const diabetes = screen.getByRole("group", { name: "Diabetes: ¿en quién?" });
    await user.click(within(diabetes).getByRole("checkbox", { name: "Madre" }));
    await user.click(within(diabetes).getByRole("checkbox", { name: "Padre" }));
    await user.click(screen.getByRole("checkbox", { name: "Hipertensión" }));
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(mocked.saveSection).toHaveBeenCalledWith("r1", "family_history", {
        // Hipertensión marcada SIN parentesco no viaja; los parentescos en orden fijo.
        conditions: [{ condition: "diabetes", relatives: ["father", "mother"] }],
      }),
    );
  });

  it("«Negados» manda solo la marca, aunque haya casillas marcadas", async () => {
    await renderSection("family_history");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("checkbox", { name: "Cáncer" }));
    await user.click(screen.getByRole("checkbox", { name: "Negados" }));
    expect(screen.getByRole("checkbox", { name: "Cáncer" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(mocked.saveSection).toHaveBeenCalledWith("r1", "family_history", { negated: true }),
    );
  });

  it("precarga lo guardado: la enfermedad marcada, sus chips y «otra» con su nombre", async () => {
    await renderSection(
      "family_history",
      expediente(
        {},
        {
          family_history: {
            conditions: [
              { condition: "diabetes", relatives: ["mother"], notes: "Tipo 2" },
              { condition: "other", relatives: ["siblings"], otherLabel: "Lupus" },
            ],
            notes: "Abuela finada por DM",
          },
        },
      ),
    );
    expect(await screen.findByRole("checkbox", { name: "Diabetes" })).toBeChecked();
    const diabetes = screen.getByRole("group", { name: "Diabetes: ¿en quién?" });
    expect(within(diabetes).getByRole("checkbox", { name: "Madre" })).toBeChecked();
    expect(within(diabetes).getByRole("checkbox", { name: "Padre" })).not.toBeChecked();
    expect(screen.getByLabelText("¿Cuál?")).toHaveValue("Lupus");
    expect(screen.getByLabelText("Notas (opcional)")).toHaveValue("Abuela finada por DM");
  });
});

/** F9-CLINIC-HC-07 — APP: seis bloques; las filas sin su dato principal no viajan. */
describe("Antecedentes Personales Patológicos (F9-CLINIC-HC-07)", () => {
  it("una cirugía con año y una crónica con tratamiento viajan; la fila vacía de arrastre no", async () => {
    await renderSection("pathological_history");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("checkbox", { name: "Varicela" }));
    await user.click(screen.getByRole("button", { name: "+ Agregar cirugía" }));
    await user.type(screen.getByLabelText("Cirugía"), "Apendicectomía");
    await user.type(screen.getByLabelText("Año (opcional)"), "2015");
    // Segunda fila que se queda vacía: no viaja.
    await user.click(screen.getByRole("button", { name: "+ Agregar cirugía" }));
    await user.click(screen.getByRole("button", { name: "+ Agregar enfermedad" }));
    await user.selectOptions(screen.getByLabelText("Enfermedad"), "diabetes");
    await user.type(screen.getByLabelText("Tratamiento (opcional)"), "Metformina");
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(mocked.saveSection).toHaveBeenCalledWith("r1", "pathological_history", {
        childhood: ["chickenpox"],
        chronic: [{ condition: "diabetes", treatment: "Metformina" }],
        surgeries: [{ procedure: "Apendicectomía", year: 2015 }],
      }),
    );
  });

  it("un año fuera de rango marca el error y no envía; «Negados» manda solo la marca", async () => {
    await renderSection("pathological_history");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "+ Agregar cirugía" }));
    await user.type(screen.getByLabelText("Cirugía"), "Hernia");
    await user.type(screen.getByLabelText("Año (opcional)"), "999");
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    expect(screen.getByRole("alert")).toHaveTextContent("El valor mínimo es 1900");
    expect(mocked.saveSection).not.toHaveBeenCalled();
    await user.click(screen.getByRole("checkbox", { name: "Negados" }));
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(mocked.saveSection).toHaveBeenCalledWith("r1", "pathological_history", {
        negated: true,
      }),
    );
  });

  it("precarga transfusión con reacción, hospitalización e infecciosas", async () => {
    await renderSection(
      "pathological_history",
      expediente(
        {},
        {
          pathological_history: {
            transfusions: { had: true, year: 2010, reaction: "Fiebre" },
            hospitalizations: [{ reason: "Neumonía", year: 2020 }],
            infectious: ["covid19"],
          },
        },
      ),
    );
    expect(
      await screen.findByRole("checkbox", { name: "Ha recibido transfusiones" }),
    ).toBeChecked();
    expect(screen.getByLabelText("Reacción (opcional)")).toHaveValue("Fiebre");
    expect(screen.getByLabelText("Motivo")).toHaveValue("Neumonía");
    expect(screen.getByRole("checkbox", { name: "COVID-19" })).toBeChecked();
  });
});

/** F9-CLINIC-HC-08 — APNP: hábitos, vivienda y el índice tabáquico calculado. */
describe("Antecedentes Personales No Patológicos (F9-CLINIC-HC-08)", () => {
  it("fuma 20 al día por 10 años: pinta 10 paquetes-año y guarda solo los datos, no el índice", async () => {
    await renderSection("non_pathological_history");
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText("Tabaquismo"), "current");
    await user.type(screen.getByLabelText("Cigarros al día"), "20");
    await user.type(screen.getByLabelText("Años fumando"), "10");
    expect(screen.getByText("Índice tabáquico: 10 paquetes-año")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Tipo sanguíneo y Rh"), "O+");
    await user.click(screen.getByRole("checkbox", { name: "Agua" }));
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(mocked.saveSection).toHaveBeenCalledWith("r1", "non_pathological_history", {
        housing: { services: ["water"] },
        smoking: { status: "current", cigarettesPerDay: 20, years: 10 },
        bloodType: "O+",
      }),
    );
  });

  it("cambiar a «Nunca ha fumado» esconde cigarros y años y no los manda", async () => {
    await renderSection(
      "non_pathological_history",
      expediente(
        {},
        {
          non_pathological_history: {
            smoking: { status: "current", cigarettesPerDay: 20, years: 10 },
          },
        },
      ),
    );
    const user = userEvent.setup();
    expect(await screen.findByLabelText("Cigarros al día")).toHaveValue("20");
    await user.selectOptions(screen.getByLabelText("Tabaquismo"), "never");
    expect(screen.queryByLabelText("Cigarros al día")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(mocked.saveSection).toHaveBeenCalledWith("r1", "non_pathological_history", {
        smoking: { status: "never" },
      }),
    );
  });
});

/** F9-CLINIC-HC-09 — AGO: G/P/A/C y la FPP calculada desde la FUM. */
describe("Antecedentes Gineco-Obstétricos (F9-CLINIC-HC-09)", () => {
  it("FUM 2026-01-01 con embarazo pinta la FPP del 08/10/2026; sin embarazo no la pinta; guarda enteros", async () => {
    await renderSection("gyneco_obstetric_history");
    const user = userEvent.setup();
    fireEvent.change(await screen.findByLabelText("Última menstruación (FUM)"), {
      target: { value: "2026-01-01" },
    });
    expect(screen.queryByTestId("edd")).not.toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "Embarazo actual" }));
    expect(screen.getByTestId("edd")).toHaveTextContent("Fecha probable de parto: 08/10/2026");
    await user.type(screen.getByLabelText("Gestas (G)"), "2");
    await user.type(screen.getByLabelText("Partos (P)"), "1");
    await user.type(screen.getByLabelText("Cesáreas (C)"), "1");
    await user.selectOptions(screen.getByLabelText("Método de planificación"), "iud");
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(mocked.saveSection).toHaveBeenCalledWith("r1", "gyneco_obstetric_history", {
        gestations: 2,
        births: 1,
        cesareans: 1,
        lastPeriodDate: "2026-01-01",
        contraception: "iud",
        pregnant: true,
      }),
    );
  });

  it("P + A + C distinto de G avisa sin bloquear; una menarca de 7 marca error y no envía", async () => {
    await renderSection("gyneco_obstetric_history");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Gestas (G)"), "3");
    await user.type(screen.getByLabelText("Partos (P)"), "1");
    expect(screen.getByText(/P \+ A \+ C no suma G/)).toBeInTheDocument();
    await user.type(screen.getByLabelText("Menarca (edad)"), "7");
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    expect(screen.getByRole("alert")).toHaveTextContent("El valor mínimo es 8");
    expect(mocked.saveSection).not.toHaveBeenCalled();
  });
});

/** F9-CLINIC-HC-10 — Alergias: negadas o lista; la fila sin sustancia no viaja. */
describe("Alergias (F9-CLINIC-HC-10)", () => {
  it("dos filas guardan dos ítems en orden; una tercera sin sustancia no viaja", async () => {
    await renderSection("allergies");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "+ Agregar alergia" }));
    await user.type(screen.getByLabelText("Sustancia"), "Penicilina");
    await user.type(screen.getByLabelText("Reacción (opcional)"), "Urticaria");
    await user.selectOptions(screen.getByLabelText("Gravedad (opcional)"), "severe");
    await user.click(screen.getByRole("button", { name: "+ Agregar alergia" }));
    const sustancias = screen.getAllByLabelText("Sustancia");
    await user.selectOptions(screen.getAllByLabelText("Tipo")[1] as HTMLElement, "food");
    await user.type(sustancias[1] as HTMLElement, "Mariscos");
    await user.click(screen.getByRole("button", { name: "+ Agregar alergia" }));
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(mocked.saveSection).toHaveBeenCalledWith("r1", "allergies", {
        items: [
          { kind: "drug", substance: "Penicilina", reaction: "Urticaria", severity: "severe" },
          { kind: "food", substance: "Mariscos" },
        ],
      }),
    );
  });

  it("«Negadas» manda solo la marca; precarga pinta las filas", async () => {
    await renderSection(
      "allergies",
      expediente({}, { allergies: { items: [{ kind: "latex", substance: "Látex" }] } }),
    );
    const user = userEvent.setup();
    expect(await screen.findByLabelText("Sustancia")).toHaveValue("Látex");
    await user.click(screen.getByRole("checkbox", { name: "Negadas" }));
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(mocked.saveSection).toHaveBeenCalledWith("r1", "allergies", { negated: true }),
    );
  });
});

/** F9-CLINIC-HC-11 — Medicamentos actuales: ninguno o lista. */
describe("Medicamentos Actuales (F9-CLINIC-HC-11)", () => {
  it("una fila con nombre y dosis viaja; «No toma medicamentos» manda none", async () => {
    await renderSection("current_medications");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "+ Agregar medicamento" }));
    await user.type(screen.getByLabelText("Medicamento"), "Metformina");
    await user.type(screen.getByLabelText("Dosis (opcional)"), "850 mg");
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(mocked.saveSection).toHaveBeenCalledWith("r1", "current_medications", {
        items: [{ name: "Metformina", dose: "850 mg" }],
      }),
    );
    mocked.saveSection.mockClear();
    await renderSection("current_medications");
    await user.click(
      (await screen.findAllByRole("checkbox", { name: "No toma medicamentos" })).at(
        -1,
      ) as HTMLElement,
    );
    await user.click(
      (await screen.findAllByRole("button", { name: "Guardar" })).at(-1) as HTMLElement,
    );
    await waitFor(() =>
      expect(mocked.saveSection).toHaveBeenCalledWith("r1", "current_medications", { none: true }),
    );
  });
});

/** F9-CLINIC-HC-12 — Aparatos y sistemas: negado POR SISTEMA, no en la raíz. */
describe("Interrogatorio por Aparatos y Sistemas (F9-CLINIC-HC-12)", () => {
  it("«Todos negados» guarda los once sistemas negados; uno con síntomas guarda su texto", async () => {
    await renderSection("systems_review");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Todos negados" }));
    expect(
      screen.getByText("tos, expectoración, hemoptisis, sibilancias, dolor pleurítico"),
    ).toBeInTheDocument();
    const digestivo = screen.getByRole("radiogroup", { name: "Digestivo" });
    await user.click(within(digestivo).getByRole("radio", { name: "Con síntomas" }));
    await user.type(screen.getByLabelText("Con síntomas: Digestivo"), "Dolor epigástrico");
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(mocked.saveSection).toHaveBeenCalled());
    const body = mocked.saveSection.mock.calls[0]?.[2] as { systems: Record<string, unknown> };
    expect(body).toEqual({
      systems: {
        general: { normal: true },
        skin: { normal: true },
        cardiovascular: { normal: true },
        respiratory: { normal: true },
        digestive: { findings: "Dolor epigástrico" },
        genitourinary: { normal: true },
        endocrine: { normal: true },
        nervous: { normal: true },
        musculoskeletal: { normal: true },
        hematologic: { normal: true },
        psychiatric: { normal: true },
      },
    });
  });
});

/** F9-CLINIC-HC-13 — lo que la NOM 6.1.1 pide en la ficha de identificación. */
describe("Datos Generales: grupo étnico y religión (F9-CLINIC-HC-13)", () => {
  it("guarda ethnicGroup y religion", async () => {
    await renderSection("general_data");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Grupo étnico (opcional)"), "Náhuatl");
    await user.type(screen.getByLabelText("Religión (opcional)"), "Católica");
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(mocked.saveSection).toHaveBeenCalledWith("r1", "general_data", {
        ethnicGroup: "Náhuatl",
        religion: "Católica",
      }),
    );
  });
});
