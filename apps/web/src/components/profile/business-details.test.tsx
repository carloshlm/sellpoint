import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@/i18n";
import { createQueryClient } from "@/lib/query-client";
import * as tenantApi from "@/lib/tenant/api";
import type { AuthUser } from "@/stores/auth.store";
import { buildAuthUser } from "@/test/auth-fixture";
import { SUBSCRIPTION_PLUS } from "@/test/subscription-fixture";
import { buildTenantBlock } from "@/test/tenant-fixture";
import { BusinessDetails } from "./business-details";

/**
 * Datos del negocio en "Mi perfil" (Carlos, 2026-08-25).
 *
 * Los datos que el wizard capturó una vez (nombre legal, identificación
 * fiscal, dirección) no pueden quedar atrapados ahí: el wizard corre UNA vez
 * y los negocios cambian de domicilio. Esta tarjeta es la puerta de edición
 * permanente — el wizard no se toca.
 */
vi.mock("@/lib/tenant/api", async (importOriginal) => ({
  ...(await importOriginal<typeof tenantApi>()),
  updateMyTenant: vi.fn(),
}));
vi.mock("@/lib/auth/session-resync", () => ({
  resyncSession: vi.fn().mockResolvedValue(undefined),
}));

const mockedUpdate = vi.mocked(tenantApi.updateMyTenant);

const demoUser = (permissions: string[]): AuthUser =>
  buildAuthUser({
    permissions,
    tenant: buildTenantBlock({
      legalName: "Acme SA de CV",
      taxId: "ACM010101AAA",
      address: "Av. Siempre Viva 123",
      phone: "+525512345678",
    }),
  });

function renderCard(user: AuthUser) {
  return render(
    <I18nextProvider i18n={createI18n()}>
      <QueryClientProvider client={createQueryClient()}>
        <BusinessDetails user={user} />
      </QueryClientProvider>
    </I18nextProvider>,
  );
}

beforeEach(() => {
  mockedUpdate.mockReset();
});

describe("Datos del negocio en Mi perfil (2026-08-25)", () => {
  /** F4-TAXMARK-04: la etiqueta del registro fiscal es la del país del negocio. */
  it("en Canadá el campo se llama GST/HST No. y en un país no curado, Identificación fiscal", () => {
    renderCard(
      buildAuthUser({
        permissions: ["tenants:manage"],
        tenant: buildTenantBlock({ country: "CA", taxId: "123456789 RT0001" }),
      }),
    );
    expect(screen.getByLabelText("GST/HST No.")).toHaveValue("123456789 RT0001");
    cleanup();
    renderCard(
      buildAuthUser({
        permissions: ["tenants:manage"],
        tenant: buildTenantBlock({ country: "JP", taxId: "T1" }),
      }),
    );
    expect(screen.getByLabelText("Identificación fiscal")).toHaveValue("T1");
  });

  /**
   * Mismo criterio que el botón Crear de los movimientos: sin permiso la
   * tarjeta NO EXISTE — deshabilitarla sugeriría que falta un clic, no un
   * permiso.
   */
  it("sin tenants:manage la tarjeta no existe", () => {
    renderCard(demoUser(["users:read"]));

    expect(screen.queryByTestId("business-details")).not.toBeInTheDocument();
  });

  it("con tenants:manage muestra los datos del wizard ya capturados", () => {
    renderCard(demoUser(["tenants:manage"]));

    expect(screen.getByLabelText("Nombre del negocio")).toHaveValue("Acme");
    expect(screen.getByLabelText("Nombre legal")).toHaveValue("Acme SA de CV");
    // F4-TAXMARK-04: en México el campo se llama RFC.
    expect(screen.getByLabelText("RFC")).toHaveValue("ACM010101AAA");
    expect(screen.getByLabelText("Calle y número")).toHaveValue("Av. Siempre Viva 123");
  });

  /**
   * El teléfono compuesto (Carlos, 2026-08-25, segunda pasada): la tarjeta
   * pinta país + número, pero lo GUARDADO es un E.164 canónico. Al abrir, el
   * canónico se descompone de vuelta — y como un dial no identifica país
   * ("1" es todo el NANP), el país del tenant desempata.
   */
  describe("el teléfono se compone de país + número", () => {
    it("el E.164 guardado se descompone: país en el select, nacional en el input", () => {
      renderCard(demoUser(["tenants:manage"]));

      expect(screen.getByLabelText("Código de país")).toHaveValue("MX");
      expect(screen.getByLabelText(/Teléfono móvil/)).toHaveValue("5512345678");
    });

    it("sin teléfono guardado, el país del NEGOCIO preselecciona el dial", () => {
      const user = demoUser(["tenants:manage"]);
      user.tenant = { ...user.tenant, phone: null };
      renderCard(user);

      expect(screen.getByLabelText("Código de país")).toHaveValue("MX");
      expect(screen.getByLabelText(/Teléfono móvil/)).toHaveValue("");
    });

    it("un dial compartido (+1) se desempata con el país del tenant", () => {
      const user = demoUser(["tenants:manage"]);
      user.tenant = { ...user.tenant, phone: "+15551234567", country: "CA" };
      renderCard(user);

      expect(screen.getByLabelText("Código de país")).toHaveValue("CA");
      expect(screen.getByLabelText(/Teléfono móvil/)).toHaveValue("5551234567");
    });

    it("los interruptores van en este orden: vender sin existencias, mostrar existencias, ubicaciones", () => {
      renderCard(demoUser(["tenants:manage"]));
      expect(screen.getAllByRole("checkbox").map((c) => c.getAttribute("aria-label"))).toEqual([
        "Vender sin existencias",
        "Mostrar existencias en el punto de venta",
        "Usar ubicaciones de almacén",
      ]);
    });

    /**
     * F4-POSVIS (Carlos, 2026-09-04): «¿el vendedor ve cuánto hay?» es otra
     * pregunta que «¿se puede cobrar de más?». Un interruptor propio, encendido
     * por defecto, que se guarda al vuelo como el de ubicaciones.
     */
    it("«Mostrar existencias en el punto de venta» se apaga al vuelo y manda posShowsStock:false", async () => {
      const user = userEvent.setup();
      const actor = demoUser(["tenants:manage"]);
      mockedUpdate.mockResolvedValue({ ...actor.tenant, posShowsStock: false });
      renderCard(actor);

      const casilla = screen.getByRole("checkbox", {
        name: "Mostrar existencias en el punto de venta",
      });
      expect(casilla).toBeChecked();
      await user.click(casilla);

      await waitFor(() => {
        expect(mockedUpdate.mock.calls[0]?.[0]).toEqual({ posShowsStock: false });
      });
    });

    it("la meta mensual se guarda como número (F5-DASH-02)", async () => {
      const user = userEvent.setup();
      const actor = demoUser(["tenants:manage"]);
      mockedUpdate.mockResolvedValue({ ...actor.tenant, monthlySalesGoal: "800000" });
      renderCard(actor);

      await user.type(screen.getByLabelText(/Meta mensual de ventas/), "800000");
      await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

      await waitFor(() => {
        expect(mockedUpdate.mock.calls[0]?.[0]).toEqual({ monthlySalesGoal: 800000 });
      });
    });

    /**
     * Carlos (2026-09-01): en celular el formulario es largo y el mensaje de
     * éxito vive arriba — guardar «no hacía nada» visible. El foco se va al
     * cuadro verde (y el navegador lo trae a la vista con el scroll).
     */
    it("al guardar, el mensaje de éxito recibe el foco para que el scroll lo alcance", async () => {
      const user = userEvent.setup();
      const actor = demoUser(["tenants:manage"]);
      mockedUpdate.mockResolvedValue({ ...actor.tenant });
      renderCard(actor);

      // Hay que ENSUCIAR un campo: sin cambios, guardar no manda nada (y con
      // razón — un PATCH vacío es 400).
      await user.type(screen.getByLabelText(/Meta mensual de ventas/), "90000");
      await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

      const aviso = await screen.findByTestId("business-details-success");
      expect(aviso).toHaveAttribute("role", "status");
      expect(aviso).toHaveClass("bg-success-soft");
      expect(aviso).toHaveFocus();
    });

    it("vaciar la meta la BORRA: manda null, no cero ni string vacío", async () => {
      const user = userEvent.setup();
      const actor = demoUser(["tenants:manage"]);
      actor.tenant = { ...actor.tenant, monthlySalesGoal: "500000" };
      mockedUpdate.mockResolvedValue({ ...actor.tenant, monthlySalesGoal: null });
      renderCard(actor);

      await user.clear(screen.getByLabelText(/Meta mensual de ventas/));
      await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

      await waitFor(() => {
        expect(mockedUpdate.mock.calls[0]?.[0]).toEqual({ monthlySalesGoal: null });
      });
    });

    it("guardar compone el canónico: dial del país elegido + número sin espacios", async () => {
      const user = userEvent.setup();
      const actor = demoUser(["tenants:manage"]);
      actor.tenant = { ...actor.tenant, phone: null };
      mockedUpdate.mockResolvedValue({ ...actor.tenant, phone: "+525598765432" });
      renderCard(actor);

      await user.type(screen.getByLabelText(/Teléfono móvil/), "55 9876 5432");
      await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

      await waitFor(() => {
        expect(mockedUpdate.mock.calls[0]?.[0]).toEqual({ phone: "+525598765432" });
      });
    });

    it("cambiar SOLO el país re-compone el número con el dial nuevo", async () => {
      const user = userEvent.setup();
      mockedUpdate.mockResolvedValue(demoUser(["tenants:manage"]).tenant);
      renderCard(demoUser(["tenants:manage"]));

      await user.selectOptions(screen.getByLabelText("Código de país"), "US");
      await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

      await waitFor(() => {
        expect(mockedUpdate.mock.calls[0]?.[0]).toEqual({ phone: "+15512345678" });
      });
    });

    it("un número con letras NO se manda: error de validación", async () => {
      const user = userEvent.setup();
      renderCard(demoUser(["tenants:manage"]));

      await user.clear(screen.getByLabelText(/Teléfono móvil/));
      await user.type(screen.getByLabelText(/Teléfono móvil/), "55ABC1234");
      await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

      expect(await screen.findByText(/solo dígitos/i)).toBeInTheDocument();
      expect(mockedUpdate).not.toHaveBeenCalled();
    });
  });

  /**
   * País FIJO + zona horaria editable + moneda visible (Carlos, 2026-08-26,
   * segunda pasada). El país dejó de ser editable el mismo día que nació
   * editable: los impuestos por país vienen en el roadmap y un cambio de
   * país los rompería — mismo criterio que congeló la moneda. La zona sí se
   * edita (los negocios se mudan dentro de su país).
   */
  describe("país fijo, zona horaria editable y moneda visible (2026-08-26)", () => {
    it("el país se muestra con su nombre pero NO es un campo editable", () => {
      renderCard(demoUser(["tenants:manage"]));

      expect(screen.getByTestId("business-country")).toHaveTextContent("México");
      expect(screen.queryByRole("combobox", { name: "País" })).not.toBeInTheDocument();
      expect(screen.queryByRole("textbox", { name: "País" })).not.toBeInTheDocument();
    });

    it("el país va hasta arriba y la zona horaria después de la dirección", () => {
      renderCard(demoUser(["tenants:manage"]));

      const country = screen.getByTestId("business-country");
      const name = screen.getByLabelText("Nombre del negocio");
      const address = screen.getByLabelText("Calle y número");
      const timezone = screen.getByLabelText("Zona horaria");

      // DOCUMENT_POSITION_FOLLOWING = el argumento está DESPUÉS del receptor.
      expect(country.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(
        address.compareDocumentPosition(timezone) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    it("la zona llega precargada y solo ofrece las zonas del país del negocio", () => {
      renderCard(demoUser(["tenants:manage"]));

      const timezone = screen.getByLabelText<HTMLSelectElement>("Zona horaria");
      expect(timezone).toHaveValue("America/Mexico_City");
      const values = [...timezone.options].map((option) => option.value).filter(Boolean);
      expect(values).toEqual([
        "America/Mexico_City",
        "America/Cancun",
        "America/Hermosillo",
        "America/Tijuana",
      ]);
    });

    it("la moneda se muestra con su nombre pero NO es un campo editable", () => {
      renderCard(demoUser(["tenants:manage"]));

      expect(screen.getByTestId("business-currency")).toHaveTextContent("Peso mexicano (MXN)");
      expect(screen.queryByRole("combobox", { name: "Moneda" })).not.toBeInTheDocument();
      expect(screen.queryByRole("textbox", { name: "Moneda" })).not.toBeInTheDocument();
    });

    it("cambiar la zona horaria manda SOLO timezone", async () => {
      const user = userEvent.setup();
      mockedUpdate.mockResolvedValue({
        ...demoUser(["tenants:manage"]).tenant,
        timezone: "America/Cancun",
      });
      renderCard(demoUser(["tenants:manage"]));

      await user.selectOptions(screen.getByLabelText("Zona horaria"), "America/Cancun");
      await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

      await waitFor(() => {
        expect(mockedUpdate.mock.calls[0]?.[0]).toEqual({ timezone: "America/Cancun" });
      });
    });
  });

  it("sin cambios el botón Guardar está deshabilitado", () => {
    renderCard(demoUser(["tenants:manage"]));

    expect(screen.getByRole("button", { name: "Guardar cambios" })).toBeDisabled();
  });

  /**
   * PATCH parcial DE VERDAD: mandar los cinco campos cuando cambió uno
   * convierte cada guardado en una sobreescritura total — y un admin con la
   * pantalla abierta desde ayer pisaría los cambios de otro sin enterarse.
   */
  it("guardar manda SOLO lo modificado y avisa el éxito", async () => {
    const user = userEvent.setup();
    mockedUpdate.mockResolvedValue(demoUser(["tenants:manage"]).tenant);
    renderCard(demoUser(["tenants:manage"]));

    await user.clear(screen.getByLabelText("Calle y número"));
    await user.type(screen.getByLabelText("Calle y número"), "Calle Nueva 456");
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    // Sobre el PRIMER argumento: React Query le pasa al `mutationFn` un
    // segundo con el contexto de la mutación, que no es asunto del test.
    await waitFor(() => {
      expect(mockedUpdate.mock.calls[0]?.[0]).toEqual({ address: "Calle Nueva 456" });
    });
    expect(await screen.findByRole("status")).toHaveTextContent(/guardados/i);
  });

  /** El teléfono es opcional: vaciar el NÚMERO lo BORRA (null), no manda "". */
  it("vaciar el teléfono lo borra con null", async () => {
    const user = userEvent.setup();
    mockedUpdate.mockResolvedValue({ ...demoUser(["tenants:manage"]).tenant, phone: null });
    renderCard(demoUser(["tenants:manage"]));

    await user.clear(screen.getByLabelText(/Teléfono móvil/));
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() => {
      expect(mockedUpdate.mock.calls[0]?.[0]).toEqual({ phone: null });
    });
  });

  /** Los datos del wizard eran requeridos y lo siguen siendo: no se vacían. */
  it("un campo requerido vaciado NO se manda: error de validación", async () => {
    const user = userEvent.setup();
    renderCard(demoUser(["tenants:manage"]));

    await user.clear(screen.getByLabelText("Nombre del negocio"));
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    expect(await screen.findByText("Este campo es obligatorio")).toBeInTheDocument();
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it("un error del API se muestra, no se traga", async () => {
    const user = userEvent.setup();
    mockedUpdate.mockRejectedValue({ statusCode: 500, message: "Algo salió mal" });
    renderCard(demoUser(["tenants:manage"]));

    await user.type(screen.getByLabelText("Nombre del negocio"), " Retail");
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Algo salió mal");
  });

  describe("Vender sin existencias (F7-POS-05)", () => {
    it("con plan CON control de stock el switch aparece apagado y al activarlo manda el PATCH", async () => {
      const user = demoUser(["tenants:manage"]);
      mockedUpdate.mockResolvedValue({ ...user.tenant, sellWithoutStock: true });
      renderCard(user);

      const toggle = screen.getByRole("checkbox", { name: "Vender sin existencias" });
      expect(toggle).not.toBeChecked();
      expect(toggle).toBeEnabled();

      await userEvent.click(toggle);

      await waitFor(() => {
        expect(mockedUpdate.mock.calls[0]?.[0]).toEqual({ sellWithoutStock: true });
      });
    });

    it("en un plan SIN control (Basic/Free) aparece activado y BLOQUEADO con la nota del plan", () => {
      const user = demoUser(["tenants:manage"]);
      user.subscription = { ...SUBSCRIPTION_PLUS, stockControl: false };
      renderCard(user);

      const toggle = screen.getByRole("checkbox", { name: "Vender sin existencias" });
      expect(toggle).toBeChecked();
      expect(toggle).toBeDisabled();
      expect(screen.getByText(/incluido en tu plan/i)).toBeInTheDocument();
      expect(mockedUpdate).not.toHaveBeenCalled();
    });
  });
});

/**
 * F1-ADDR-06 — la dirección estructurada en Mi perfil: se completa sin
 * obligar (un negocio existente no se traba), solo viaja lo tocado, vacío
 * borra, y la región fiscal de Canadá y Estados Unidos tiene un solo dueño.
 */
describe("Datos del negocio — dirección por país (F1-ADDR-06)", () => {
  it("un negocio con solo texto libre abre con la línea 1 llena y lo demás vacío, y guardar otra cosa NO manda la dirección", async () => {
    const user = userEvent.setup();
    mockedUpdate.mockResolvedValue(demoUser(["tenants:manage"]).tenant);
    renderCard(demoUser(["tenants:manage"]));

    expect(screen.getByLabelText("Calle y número")).toHaveValue("Av. Siempre Viva 123");
    expect(screen.getByLabelText("Colonia")).toHaveValue("");
    expect(screen.getByLabelText("Código postal")).toHaveValue("");
    expect(screen.getByLabelText("Ciudad o municipio")).toHaveValue("");

    await user.clear(screen.getByLabelText("Nombre legal"));
    await user.type(screen.getByLabelText("Nombre legal"), "Acme Nueva SA");
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    // La ley del dato: lo que no se tocó no viaja — un campo escondido o
    // vacío que viajara en null borraría la dirección en cada guardado.
    await waitFor(() => {
      expect(mockedUpdate.mock.calls[0]?.[0]).toEqual({ legalName: "Acme Nueva SA" });
    });
  });

  it("completar el CP y el estado manda exactamente esos dos, normalizados", async () => {
    const user = userEvent.setup();
    mockedUpdate.mockResolvedValue(demoUser(["tenants:manage"]).tenant);
    renderCard(demoUser(["tenants:manage"]));

    await user.type(screen.getByLabelText("Código postal"), " 44100 ");
    await user.selectOptions(screen.getByLabelText("Estado"), "JAL");
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() => {
      expect(mockedUpdate.mock.calls[0]?.[0]).toEqual({ region: "JAL", postalCode: "44100" });
    });
  });

  it("un CP que no cumple la regla del país se marca y no se guarda", async () => {
    const user = userEvent.setup();
    renderCard(demoUser(["tenants:manage"]));

    await user.type(screen.getByLabelText("Código postal"), "4410");
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    expect(
      await screen.findByText(/código postal válido para tu país, como 02860/),
    ).toBeInTheDocument();
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it("vaciar la colonia BORRA: manda null, no cadena vacía", async () => {
    const user = userEvent.setup();
    const conColonia = demoUser(["tenants:manage"]);
    conColonia.tenant = { ...conColonia.tenant, addressLine2: "Col. Centro" };
    mockedUpdate.mockResolvedValue(conColonia.tenant);
    renderCard(conColonia);

    await user.clear(screen.getByLabelText("Colonia"));
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() => {
      expect(mockedUpdate.mock.calls[0]?.[0]).toEqual({ addressLine2: null });
    });
  });

  it("Canadá: la provincia se ve pero no se edita acá (es fiscal), y nunca viaja en el PATCH", async () => {
    const user = userEvent.setup();
    const canadiense = demoUser(["tenants:manage"]);
    canadiense.tenant = { ...canadiense.tenant, country: "CA", region: "ON", phone: null };
    mockedUpdate.mockResolvedValue(canadiense.tenant);
    renderCard(canadiense);

    const provincia = screen.getByRole("combobox", { name: "Provincia o territorio" });
    expect(provincia).toBeDisabled();
    expect(provincia).toHaveValue("ON");
    expect(screen.getByText(/Se cambia en Impuestos/)).toBeInTheDocument();

    await user.type(screen.getByLabelText("Ciudad o municipio"), "Toronto");
    await user.type(screen.getByLabelText("Código postal"), "m5v3l9");
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() => {
      expect(mockedUpdate.mock.calls[0]?.[0]).toEqual({ city: "Toronto", postalCode: "M5V 3L9" });
    });
  });
});

/**
 * Carlos, 2026-09-08: «Meta mensual de ventas debe tener el formato así como
 * los demás montos». Es un importe en la moneda del negocio y va a la MISMA
 * columna `DECIMAL(14,2)` que el costo y el precio: mismo campo, misma
 * aritmética, mismo rechazo de la coma.
 */
describe("Datos del negocio — la meta mensual es un importe (F5-DASH-02 + MoneyField)", () => {
  it("muestra el símbolo y el código de la moneda del negocio, como costo y precio", () => {
    renderCard(demoUser(["tenants:manage"]));

    const meta = screen.getByLabelText(/Meta mensual de ventas/);
    const caja = meta.parentElement as HTMLElement;
    expect(within(caja).getByText("$")).toBeInTheDocument();
    expect(within(caja).getByText("MXN")).toBeInTheDocument();
  });

  it("abre a dos decimales lo que el API devuelve sin ceros («25000» → «25000.00»)", () => {
    const actor = demoUser(["tenants:manage"]);
    actor.tenant = { ...actor.tenant, monthlySalesGoal: "25000" };
    renderCard(actor);

    expect(screen.getByLabelText(/Meta mensual de ventas/)).toHaveValue("25000.00");
  });

  it("al salir del campo completa a dos decimales", async () => {
    const user = userEvent.setup();
    renderCard(demoUser(["tenants:manage"]));

    const meta = screen.getByLabelText(/Meta mensual de ventas/);
    await user.type(meta, "25000");
    await user.tab();

    expect(meta).toHaveValue("25000.00");
  });

  it("la coma se rechaza con el mensaje que enseña el formato, y no se guarda", async () => {
    const user = userEvent.setup();
    renderCard(demoUser(["tenants:manage"]));

    await user.type(screen.getByLabelText(/Meta mensual de ventas/), "25,000");
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    expect(await screen.findByText(/punto decimal/)).toBeInTheDocument();
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it("cero no es una meta: lo dice y ofrece la alternativa de dejarla vacía", async () => {
    const user = userEvent.setup();
    renderCard(demoUser(["tenants:manage"]));

    await user.type(screen.getByLabelText(/Meta mensual de ventas/), "0");
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    expect(await screen.findByText(/mayor que cero/)).toBeInTheDocument();
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it("un importe con tres decimales se marca, igual que en costo y precio", async () => {
    const user = userEvent.setup();
    renderCard(demoUser(["tenants:manage"]));

    await user.type(screen.getByLabelText(/Meta mensual de ventas/), "25000.555");
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    expect(await screen.findByText(/2 decimales/)).toBeInTheDocument();
    expect(mockedUpdate).not.toHaveBeenCalled();
  });
});

/** F1-TAXID-03 — solo se valida lo que cambió; el error y el hint enseñan el ejemplo. */
describe("Datos del negocio — el registro fiscal por país (F1-TAXID-03)", () => {
  const MENSAJE = "Escribe una identificación fiscal válida para tu país, como ABC010101AB1";

  it("un RFC viejo mal guardado no impide cambiar otra cosa: el patrón corre solo sobre lo que cambió", async () => {
    const user = userEvent.setup();
    const actor = buildAuthUser({
      permissions: ["tenants:manage"],
      tenant: buildTenantBlock({
        legalName: "Acme SA de CV",
        taxId: "CINCO8507223N4",
        address: "Av. Siempre Viva 123",
        phone: "+525512345678",
      }),
    });
    mockedUpdate.mockResolvedValue({ ...actor.tenant, name: "Acme 2" });
    renderCard(actor);
    const nombre = screen.getByLabelText("Nombre del negocio");
    await user.clear(nombre);
    await user.type(nombre, "Acme 2");
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() => expect(mockedUpdate.mock.calls[0]?.[0]).toEqual({ name: "Acme 2" }));
    expect(screen.queryByText(MENSAJE)).not.toBeInTheDocument();
  });

  /**
   * El aviso va ARRIBA, con el foco: en el navegador un `setError` sobre el
   * campo no sobrevivía al ciclo de validación que dispara el `onBlur` que
   * normaliza, y el mensaje desaparecía (2026-09-10). El test mira el cuadro,
   * no el campo, porque el cuadro es lo que el usuario ve.
   */
  it("al tocar el RFC y dejarlo mal, el aviso enseña el ejemplo, se lleva el foco y no se guarda", async () => {
    const user = userEvent.setup();
    renderCard(demoUser(["tenants:manage"]));
    const rfc = screen.getByLabelText("RFC");
    await user.clear(rfc);
    await user.type(rfc, "CINCO8507223N4");
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));
    const aviso = await screen.findByTestId("business-details-error");
    expect(aviso).toHaveTextContent(MENSAJE);
    expect(aviso).toHaveFocus();
    expect(mockedUpdate).not.toHaveBeenCalled();
  });

  it("el hint enseña el ejemplo del país y en minúsculas se normaliza al salir del campo", async () => {
    const user = userEvent.setup();
    renderCard(demoUser(["tenants:manage"]));
    expect(screen.getByText("Por ejemplo ABC010101AB1")).toBeInTheDocument();
    const rfc = screen.getByLabelText("RFC");
    await user.clear(rfc);
    await user.type(rfc, "xaxx010101000");
    await user.tab();
    expect(rfc).toHaveValue("XAXX010101000");
  });
});

/**
 * Carlos (2026-09-10), con la tarjeta en pantalla: el registro fiscal es
 * OPCIONAL —un negocio que no lo tiene o no lo sabe debe poder guardar lo
 * demás— y, cuando algo falla, el aviso tiene que VERSE: el formulario es
 * largo y el mensaje vive arriba.
 */
describe("Datos del negocio — el registro fiscal es opcional y el error se ve (2026-09-10)", () => {
  it("vaciar el registro fiscal lo BORRA (null) y no bloquea el guardado", async () => {
    const user = userEvent.setup();
    const actor = demoUser(["tenants:manage"]);
    mockedUpdate.mockResolvedValue({ ...actor.tenant, taxId: null });
    renderCard(actor);

    await user.clear(screen.getByLabelText("RFC"));
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() => expect(mockedUpdate.mock.calls[0]?.[0]).toEqual({ taxId: null }));
  });

  /**
   * El bug que Carlos vio: `onBlur` normalizaba con `shouldDirty`, así que
   * PASAR el foco por el campo lo marcaba como tocado y el registro viejo
   * viajaba al servidor, que lo rechazaba con 422. Tocar no es cambiar.
   */
  it("pasar el foco por el registro fiscal sin cambiarlo NO lo manda", async () => {
    const user = userEvent.setup();
    const actor = buildAuthUser({
      permissions: ["tenants:manage"],
      tenant: buildTenantBlock({
        legalName: "Acme SA de CV",
        taxId: "CINCO8507223N4",
        address: "Av. Siempre Viva 123",
        phone: "+525512345678",
      }),
    });
    mockedUpdate.mockResolvedValue({ ...actor.tenant, name: "Acme 2" });
    renderCard(actor);

    await user.click(screen.getByLabelText("RFC"));
    await user.tab();
    const nombre = screen.getByLabelText("Nombre del negocio");
    await user.clear(nombre);
    await user.type(nombre, "Acme 2");
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() => expect(mockedUpdate.mock.calls[0]?.[0]).toEqual({ name: "Acme 2" }));
  });

  it("el error del servidor recibe el FOCO, como el mensaje de éxito", async () => {
    const user = userEvent.setup();
    mockedUpdate.mockRejectedValue({
      statusCode: 422,
      code: "tenants.invalid_tax_id",
      message: "La identificación fiscal no tiene el formato de tu país.",
      error: "Unprocessable Entity",
    });
    renderCard(demoUser(["tenants:manage"]));

    const nombre = screen.getByLabelText("Nombre del negocio");
    await user.clear(nombre);
    await user.type(nombre, "Acme 2");
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    const aviso = await screen.findByTestId("business-details-error");
    expect(aviso).toHaveTextContent("La identificación fiscal no tiene el formato de tu país.");
    expect(aviso).toHaveFocus();
  });
});
