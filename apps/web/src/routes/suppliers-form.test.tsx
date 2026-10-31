import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@/i18n";
import * as catalogsApi from "@/lib/catalogs/api";
import { createQueryClient } from "@/lib/query-client";
import * as suppliersApi from "@/lib/suppliers/api";
import { routeTree } from "@/routeTree.gen";
import { type AuthUser, useAuthStore } from "@/stores/auth.store";
import { buildAuthUser } from "@/test/auth-fixture";
import { SUBSCRIPTION_PLUS } from "@/test/subscription-fixture";
import { buildSupplier } from "@/test/supplier-fixture";
import { buildTenantBlock } from "@/test/tenant-fixture";

/**
 * F9-SUPPL-07 — la pantalla de alta y edición de proveedor: en tarjeta (skill
 * `sellpoint-forms`), la etiqueta del registro fiscal según el país del
 * negocio, y un registro repetido que AVISA sin bloquear.
 */
// F9-SUPPCAT-06: la ficha lee los campos propios del catálogo `suppliers`.
vi.mock("@/lib/catalogs/api", () => ({
  listCatalogs: vi.fn().mockResolvedValue([
    {
      id: "cat-suppliers",
      name: "Catálogo de Proveedores",
      systemKey: "suppliers",
      isSystem: true,
      isActive: true,
    },
  ]),
  listFields: vi.fn().mockResolvedValue([]),
  listLookupOptions: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/suppliers/api", () => ({
  listSuppliers: vi.fn(),
  getSupplier: vi.fn(),
  createSupplier: vi.fn(),
  updateSupplier: vi.fn(),
  removeSupplier: vi.fn(),
}));
const mocked = vi.mocked(suppliersApi);

const demoUser = (country: string | null): AuthUser =>
  buildAuthUser({
    permissions: ["suppliers:read", "suppliers:manage"],
    subscription: { ...SUBSCRIPTION_PLUS, modules: ["expenses"] },
    tenant: buildTenantBlock({ country }),
  });

const guardado: suppliersApi.Supplier = buildSupplier({ taxId: "DNO900101AB1" });

async function renderEn(path: string, country: string | null = "MX", lang: "es" | "en" = "es") {
  useAuthStore.getState().setAuth("jwt-demo", demoUser(country));
  const i18n = createI18n();
  if (lang !== "es") await i18n.changeLanguage(lang);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await router.load();
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={createQueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </I18nextProvider>,
  );
  return router;
}

beforeEach(() => {
  mocked.listSuppliers.mockResolvedValue({ rows: [], total: 0, page: 1, pageSize: 20 });
  mocked.createSupplier.mockResolvedValue(guardado);
  mocked.updateSupplier.mockResolvedValue(guardado);
  mocked.getSupplier.mockResolvedValue(guardado);
});

afterEach(() => {
  useAuthStore.getState().clearAuth();
  vi.clearAllMocks();
});

describe("alta y edición de proveedor (F9-SUPPL-07)", () => {
  it("el formulario vive en una tarjeta con su título, y el primer campo en la MISMA tarjeta", async () => {
    await renderEn("/suppliers/new");
    const titulo = await screen.findByRole("heading", { name: "Registrar proveedor" });
    const tarjeta = titulo.closest('[data-slot="card"]');
    expect(tarjeta).not.toBeNull();
    const nombre = screen.getByLabelText(/Nombre o razón social/);
    expect(nombre.closest('[data-slot="card"]')).toBe(tarjeta);
  });

  it("la etiqueta del registro fiscal cambia con el país del negocio", async () => {
    await renderEn("/suppliers/new", "MX");
    expect(await screen.findByLabelText("Registro fiscal (RFC)")).toBeInTheDocument();
    expect(screen.getByText("Por ejemplo ABC010101AB1")).toBeInTheDocument();
  });

  it("sin país del negocio la etiqueta es genérica y no hay ejemplo", async () => {
    await renderEn("/suppliers/new", null);
    expect(await screen.findByLabelText("Registro fiscal")).toBeInTheDocument();
    expect(screen.queryByText(/Por ejemplo/)).not.toBeInTheDocument();
  });

  it("un nombre vacío no dispara la mutación; con nombre, crea y vuelve al listado", async () => {
    const router = await renderEn("/suppliers/new");
    const user = userEvent.setup();
    await screen.findByRole("heading", { name: "Registrar proveedor" });
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Este campo es obligatorio.");
    expect(mocked.createSupplier).not.toHaveBeenCalled();

    // F9-SUPPCAT-04: el código se teclea en minúsculas y viaja en MAYÚSCULAS.
    await user.type(screen.getByLabelText("Código"), "norte-01");
    await user.type(screen.getByLabelText(/Nombre o razón social/), "Distribuidora Norte");
    await user.type(screen.getByLabelText("Registro fiscal (RFC)"), "dno900101ab1");
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(mocked.createSupplier).toHaveBeenCalledWith({
        code: "NORTE-01",
        name: "Distribuidora Norte",
        taxId: "DNO900101AB1",
      }),
    );
    await waitFor(() => expect(router.state.location.pathname).toBe("/suppliers"));
  });

  it("un RFC mal formado en México se rechaza antes de llamar al API, con el ejemplo", async () => {
    await renderEn("/suppliers/new", "MX");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(/Nombre o razón social/), "Norte");
    await user.type(screen.getByLabelText("Registro fiscal (RFC)"), "NOPE");
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("como ABC010101AB1");
    expect(mocked.createSupplier).not.toHaveBeenCalled();
  });

  it("un registro fiscal repetido AVISA al salir del campo y no impide guardar", async () => {
    mocked.listSuppliers.mockResolvedValue({
      rows: [{ ...guardado, id: "s9", name: "Norte (el otro)" }],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    await renderEn("/suppliers/new", "MX");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(/Nombre o razón social/), "Norte");
    await user.type(screen.getByLabelText("Registro fiscal (RFC)"), "dno900101ab1");
    await user.tab();
    const aviso = await screen.findByTestId("duplicate-supplier");
    expect(aviso).toHaveTextContent("Ya hay 1 proveedor con este registro fiscal");
    expect(within(aviso).getByText("Norte (el otro)")).toBeInTheDocument();
    expect(within(aviso).getByRole("link", { name: "Editar" })).toHaveAttribute(
      "href",
      "/suppliers/s9",
    );
    // Se comprobó con el valor NORMALIZADO, que es como está guardado.
    expect(mocked.listSuppliers).toHaveBeenCalledWith(
      expect.objectContaining({ query: "DNO900101AB1" }),
    );

    await user.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(mocked.createSupplier).toHaveBeenCalled());
  });

  it("editar manda al PATCH solo lo que cambió, incluido retirarlo", async () => {
    const router = await renderEn("/suppliers/s1");
    const user = userEvent.setup();
    await screen.findByRole("heading", { name: "Editar proveedor" });
    const contacto = await screen.findByLabelText("Contacto 1");
    await user.type(contacto, "Luis Gómez");
    await user.click(screen.getByRole("checkbox", { name: "Proveedor activo" }));
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(mocked.updateSupplier).toHaveBeenCalledWith("s1", {
        contactName: "Luis Gómez",
        isActive: false,
      }),
    );
    await waitFor(() => expect(router.state.location.pathname).toBe("/suppliers"));
  });

  /**
   * F9-SUPPCAT-06 (Carlos, 2026-09-12): proveedores es personalizable como
   * almacenes. Un campo propio del catálogo `suppliers` se pinta en la ficha,
   * viaja en `attributes`, y un error POR CAMPO del API cae bajo su input.
   */
  it("pinta el campo propio del catálogo de proveedores, lo manda en attributes y pinta su error", async () => {
    vi.mocked(catalogsApi.listFields).mockResolvedValue([
      {
        id: "f-credito",
        catalogId: "cat-suppliers",
        key: "dias_de_credito",
        label: "Días de crédito",
        fieldType: "number",
        lookupCatalogId: null,
        required: true,
        position: 0,
        isArchived: false,
      },
    ]);
    mocked.createSupplier.mockRejectedValueOnce({
      statusCode: 400,
      message: "Revisa los campos marcados.",
      error: "Bad Request",
      errors: [{ key: "dias_de_credito", message: "catalogs.field_required" }],
    });
    await renderEn("/suppliers/new");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(/Nombre o razón social/), "Acme");
    const credito = await screen.findByLabelText("Días de crédito *");
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(mocked.createSupplier).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Acme", attributes: {} }),
      ),
    );
    await waitFor(() => expect(credito).toBeInvalid());

    await user.type(credito, "30");
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(mocked.createSupplier).toHaveBeenLastCalledWith(
        expect.objectContaining({ attributes: { dias_de_credito: 30 } }),
      ),
    );
  });
});

/**
 * Proveedores con dirección estructurada y varios contactos (Carlos,
 * 2026-10-31): lo del proveedor arriba (código, nombre, RFC, dirección como
 * Sucursales, campos propios, notas) y abajo los contactos, el 1 en las
 * columnas del proveedor y los demás numerados.
 */
describe("dirección y contactos del proveedor (2026-10-31)", () => {
  // `clearAllMocks` no borra las respuestas: un campo propio de otra prueba no se cuela.
  beforeEach(() => {
    vi.mocked(catalogsApi.listFields).mockResolvedValue([]);
  });

  /** Las etiquetas de los campos del formulario, en el orden del DOM. */
  const etiquetasDelFormulario = () => {
    const formulario = screen.getByRole("button", { name: "Guardar" }).closest("form");
    return Array.from(formulario?.querySelectorAll("label") ?? []).map((l) => l.textContent);
  };

  it("los datos del proveedor van arriba y el contacto principal al final, en ese orden", async () => {
    vi.mocked(catalogsApi.listFields).mockResolvedValue([
      {
        id: "f-credito",
        catalogId: "cat-suppliers",
        key: "credito_maximo",
        label: "Crédito máximo",
        fieldType: "number",
        lookupCatalogId: null,
        required: false,
        position: 0,
        isArchived: false,
      },
    ]);
    await renderEn("/suppliers/new", "MX");
    await screen.findByLabelText("Crédito máximo (opcional)");
    expect(etiquetasDelFormulario()).toEqual([
      "Código",
      "Nombre o razón social",
      "Registro fiscal (RFC)",
      "Calle y número",
      "Colonia",
      "Código postal",
      "Ciudad o municipio",
      "Estado",
      "Crédito máximo (opcional)",
      "Notas",
      "Contacto 1",
      "Puesto / Cargo",
      "País del teléfono",
      "Teléfono",
      "Correo",
    ]);
  });

  it("el contacto principal se llama «Contacto 1» y trae «Puesto / Cargo»", async () => {
    await renderEn("/suppliers/new");
    expect(await screen.findByLabelText("Contacto 1")).toBeInTheDocument();
    expect(screen.getByLabelText("Puesto / Cargo")).toBeInTheDocument();
    expect(screen.queryByLabelText("Persona de contacto")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Contactos" })).toBeInTheDocument();
  });

  it("«Agregar contacto» suma un Contacto 2 y luego un 3, con el cursor en su nombre", async () => {
    await renderEn("/suppliers/new");
    const user = userEvent.setup();
    await screen.findByLabelText("Contacto 1");
    expect(screen.queryByLabelText("Contacto 2")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Agregar contacto" }));
    expect(screen.getByLabelText("Contacto 2")).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Agregar contacto" }));
    expect(screen.getByLabelText("Contacto 3")).toHaveFocus();
    // Cada contacto adicional trae los mismos campos que el 1.
    expect(screen.getAllByLabelText("Puesto / Cargo")).toHaveLength(3);
    expect(screen.getAllByLabelText("Teléfono")).toHaveLength(3);
    expect(screen.getAllByLabelText("Correo")).toHaveLength(3);
    expect(screen.getByRole("button", { name: "Quitar contacto 3" })).toBeInTheDocument();
    // El contacto 1 no se quita: es el del proveedor.
    expect(screen.queryByRole("button", { name: "Quitar contacto 1" })).not.toBeInTheDocument();
  });

  it("quitar el Contacto 2 renumera al que seguía como Contacto 2", async () => {
    await renderEn("/suppliers/new");
    const user = userEvent.setup();
    await screen.findByLabelText("Contacto 1");
    await user.click(screen.getByRole("button", { name: "Agregar contacto" }));
    await user.type(screen.getByLabelText("Contacto 2"), "Ana Ríos");
    await user.click(screen.getByRole("button", { name: "Agregar contacto" }));
    await user.type(screen.getByLabelText("Contacto 3"), "Beto Soto");

    await user.click(screen.getByRole("button", { name: "Quitar contacto 2" }));
    expect(screen.getByLabelText("Contacto 2")).toHaveValue("Beto Soto");
    expect(screen.queryByLabelText("Contacto 3")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Quitar contacto 3" })).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("Ana Ríos")).not.toBeInTheDocument();
  });

  it("con 10 contactos adicionales ya no se pueden agregar más", async () => {
    // Un proveedor que ya trae 9: un clic más llega al tope (Carlos, 2026-10-31).
    mocked.getSupplier.mockResolvedValue(
      buildSupplier({
        contacts: Array.from({ length: 9 }, (_, i) => ({
          id: `c${i + 2}`,
          name: `Contacto de prueba ${i + 2}`,
          phone: null,
          email: null,
          jobTitle: null,
        })),
      }),
    );
    await renderEn("/suppliers/s1");
    const user = userEvent.setup();
    // Con una lista de países por contacto, `getByLabelText` tarda segundos en
    // jsdom: se pregunta el nombre accesible del campo mismo.
    expect(await screen.findByDisplayValue("Contacto de prueba 10")).toHaveAccessibleName(
      "Contacto 10",
    );
    const agregar = screen.getByRole("button", { name: "Agregar contacto" });
    expect(agregar).toBeEnabled();
    await user.click(agregar);
    expect(document.activeElement).toHaveAccessibleName("Contacto 11");
    expect(agregar).toBeDisabled();
  });

  it("al crear manda la dirección, el contacto 1 con su puesto y los contactos, sin las filas vacías", async () => {
    await renderEn("/suppliers/new", "MX");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Nombre o razón social"), "Distribuidora Norte");
    await user.type(screen.getByLabelText("Calle y número"), "Av. Juárez 10");
    await user.type(screen.getByLabelText("Colonia"), "Centro");
    await user.type(screen.getByLabelText("Código postal"), "06000");
    await user.type(screen.getByLabelText("Ciudad o municipio"), "Ciudad de México");
    await user.selectOptions(screen.getByLabelText("Estado"), "CMX");
    await user.type(screen.getByLabelText("Contacto 1"), "Rosa Luna");
    await user.type(screen.getByLabelText("Puesto / Cargo"), "Gerente de ventas");
    await user.type(screen.getByLabelText("Teléfono"), "5512345678");
    await user.type(screen.getByLabelText("Correo"), "rosa@norte.mx");

    await user.click(screen.getByRole("button", { name: "Agregar contacto" }));
    await user.type(screen.getByLabelText("Contacto 2"), "Pedro Ruiz");
    await user.type(screen.getAllByLabelText("Puesto / Cargo")[1] as HTMLElement, "Cobranza");
    await user.type(screen.getAllByLabelText("Teléfono")[1] as HTMLElement, "5598765432");
    // Un contacto 3 que nadie llenó no viaja ni detiene el guardado.
    await user.click(screen.getByRole("button", { name: "Agregar contacto" }));

    await user.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(mocked.createSupplier).toHaveBeenCalledWith({
        name: "Distribuidora Norte",
        contactName: "Rosa Luna",
        jobTitle: "Gerente de ventas",
        phone: "+525512345678",
        email: "rosa@norte.mx",
        address: "Av. Juárez 10",
        addressLine2: "Centro",
        city: "Ciudad de México",
        region: "CMX",
        postalCode: "06000",
        contacts: [
          { name: "Pedro Ruiz", phone: "+525598765432", email: null, jobTitle: "Cobranza" },
        ],
      }),
    );
  });

  it("un contacto adicional con datos y sin nombre lo pide bajo su nombre, igual que el correo y el teléfono", async () => {
    await renderEn("/suppliers/new");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Nombre o razón social"), "Norte");
    await user.click(screen.getByRole("button", { name: "Agregar contacto" }));
    await user.type(screen.getAllByLabelText("Correo")[1] as HTMLElement, "no-es-correo");
    await user.type(screen.getAllByLabelText("Teléfono")[1] as HTMLElement, "12");

    await user.click(screen.getByRole("button", { name: "Guardar" }));
    const nombre = screen.getByLabelText("Contacto 2");
    await waitFor(() => expect(nombre).toBeInvalid());
    expect(nombre).toHaveAccessibleDescription("Escribe el nombre del contacto.");
    expect(screen.getAllByLabelText("Correo")[1]).toHaveAccessibleDescription(
      "Escribe un correo válido.",
    );
    expect(screen.getAllByLabelText("Teléfono")[1]).toHaveAccessibleDescription(
      "Escribe solo los dígitos del número, sin el prefijo del país.",
    );
    // El contacto 1 no tiene nada malo: sus campos siguen limpios.
    expect(screen.getByLabelText("Contacto 1")).toBeValid();
    expect(mocked.createSupplier).not.toHaveBeenCalled();
  });

  it("un código postal que no es del país del negocio no deja guardar", async () => {
    await renderEn("/suppliers/new", "MX");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Nombre o razón social"), "Norte");
    await user.type(screen.getByLabelText("Código postal"), "123");
    expect(screen.getByLabelText("Código postal")).toHaveAccessibleDescription(
      "Escribe un código postal válido para tu país, como 02860",
    );
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    expect(mocked.createSupplier).not.toHaveBeenCalled();
  });

  it("un 422 de la dirección marca el campo que rechazó el API", async () => {
    mocked.createSupplier.mockRejectedValueOnce({
      statusCode: 422,
      message: "Revisa los campos marcados.",
      error: "Unprocessable Entity",
      code: "suppliers.invalid_postal_code",
      errors: [
        {
          key: "postalCode",
          message: "El código postal no tiene el formato del país del negocio.",
        },
        { key: "region", message: "Esa provincia o estado no corresponde al país del negocio." },
      ],
    });
    await renderEn("/suppliers/new", "MX");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Nombre o razón social"), "Norte");
    await user.type(screen.getByLabelText("Código postal"), "06000");
    await user.selectOptions(screen.getByLabelText("Estado"), "CMX");
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(screen.getByLabelText("Código postal")).toHaveAccessibleDescription(
        "El código postal no tiene el formato del país del negocio.",
      ),
    );
    expect(screen.getByLabelText("Estado")).toHaveAccessibleDescription(
      "Esa provincia o estado no corresponde al país del negocio.",
    );
  });

  it("un error por campo que el formulario no pinta (p. ej. `contacts`) se muestra arriba", async () => {
    mocked.createSupplier.mockRejectedValueOnce({
      statusCode: 400,
      message: "Revisa los datos del proveedor.",
      error: "Bad Request",
      code: "suppliers.invalid_body",
      errors: [{ key: "contacts", message: "Son demasiados contactos." }],
    });
    await renderEn("/suppliers/new");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Nombre o razón social"), "Norte");
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Revisa los datos del proveedor.");
  });

  const conContactos = buildSupplier({
    taxId: "DNO900101AB1",
    contactName: "Rosa Luna",
    jobTitle: "Gerente de ventas",
    phone: "+525512345678",
    address: "Av. Juárez 10",
    addressLine2: "Centro",
    city: "Ciudad de México",
    region: "CMX",
    postalCode: "06000",
    contacts: [
      {
        id: "c2",
        name: "Pedro Ruiz",
        phone: "+525598765432",
        email: null,
        jobTitle: "Cobranza",
      },
    ],
  });

  it("editar sin tocar los contactos NO manda `contacts`, solo lo que cambió", async () => {
    mocked.getSupplier.mockResolvedValue(conContactos);
    await renderEn("/suppliers/s1");
    const user = userEvent.setup();
    expect(await screen.findByLabelText("Contacto 2")).toHaveValue("Pedro Ruiz");
    expect(screen.getByLabelText("Colonia")).toHaveValue("Centro");
    const notas = screen.getByLabelText("Notas");
    await user.type(notas, "Entrega martes");
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(mocked.updateSupplier).toHaveBeenCalledWith("s1", { notes: "Entrega martes" }),
    );
  });

  it("editar un contacto adicional manda el arreglo COMPLETO, que reemplaza al guardado", async () => {
    mocked.getSupplier.mockResolvedValue(conContactos);
    await renderEn("/suppliers/s1");
    const user = userEvent.setup();
    await screen.findByLabelText("Contacto 2");
    const puesto = screen.getAllByLabelText("Puesto / Cargo")[1] as HTMLElement;
    await user.clear(puesto);
    await user.type(puesto, "Compras");
    await user.click(screen.getByRole("button", { name: "Agregar contacto" }));
    await user.type(screen.getByLabelText("Contacto 3"), "Ana Ríos");
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(mocked.updateSupplier).toHaveBeenCalledWith("s1", {
        contacts: [
          { name: "Pedro Ruiz", phone: "+525598765432", email: null, jobTitle: "Compras" },
          { name: "Ana Ríos", phone: null, email: null, jobTitle: null },
        ],
      }),
    );
  });

  it("quitar el único contacto adicional manda `contacts: []`", async () => {
    mocked.getSupplier.mockResolvedValue(conContactos);
    await renderEn("/suppliers/s1");
    const user = userEvent.setup();
    await screen.findByLabelText("Contacto 2");
    await user.click(screen.getByRole("button", { name: "Quitar contacto 2" }));
    await user.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(mocked.updateSupplier).toHaveBeenCalledWith("s1", { contacts: [] }));
  });

  it("en inglés: «Contact 1», «Job Title», «Add contact» y «Remove contact 2»", async () => {
    await renderEn("/suppliers/new", "MX", "en");
    const user = userEvent.setup();
    expect(await screen.findByLabelText("Contact 1")).toBeInTheDocument();
    expect(screen.getByLabelText("Job Title")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Contacts" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add contact" }));
    expect(screen.getByLabelText("Contact 2")).toHaveFocus();
    expect(screen.getByRole("button", { name: "Remove contact 2" })).toBeInTheDocument();
  });
});
