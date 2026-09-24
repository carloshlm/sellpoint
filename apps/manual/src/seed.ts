import { CASHIER, DEMO, type Demo, http, idempotency, login, mailToken, today } from "./demo.js";
import type { Stack } from "./stack.js";

/**
 * La VIDA del negocio de demostración: lo que un abarrotes tiene después de
 * unas semanas con SellPointy. Todo entra por el API, por los mismos caminos
 * que usa la pantalla —un producto se da de alta, una entrada se captura y se
 * confirma, una venta se cobra en un turno abierto—, así que lo que sale en
 * las capturas es lo que el sistema de verdad produce.
 *
 * Los productos son inventados y los códigos de barras son EAN-13 válidos de
 * una serie ficticia (`750999…`), para que ningún producto real se confunda.
 */

type Json = Record<string, unknown>;
/** Una lista del API: un arreglo, o una página con `rows` (o `items`, en productos). */
const items = <T>(value: unknown): T[] => {
  if (Array.isArray(value)) return value as T[];
  const page = value as { rows?: T[]; items?: T[] };
  return page.rows ?? page.items ?? [];
};
const idOf = (value: unknown): string => {
  const v = value as { id?: string; document?: { id?: string } };
  const id = v.id ?? v.document?.id;
  if (!id) throw new Error(`La respuesta no trae id: ${JSON.stringify(value).slice(0, 300)}`);
  return id;
};

/** EAN-13 con su dígito verificador, a partir de 12 dígitos. */
function ean13(base: string): string {
  const sum = [...base].reduce((acc, d, i) => acc + Number(d) * (i % 2 === 0 ? 1 : 3), 0);
  return `${base}${(10 - (sum % 10)) % 10}`;
}

export async function seedBusiness(stack: Stack, demo: Demo): Promise<void> {
  const t = demo.token;
  const api = <T = Json>(method: string, path: string, body?: unknown) =>
    http<T>(method, path, body, t);
  console.log("Dándole vida al negocio…");

  // ── Sucursales ─────────────────────────────────────────────────────────
  const [first] = items<{ id: string }>(await api("GET", "/warehouses"));
  if (!first) throw new Error("El negocio nació sin sucursal.");
  const centro = first.id;
  await api("PATCH", `/warehouses/${centro}`, {
    name: "Sucursal Centro",
    address: "Av. Juárez 123",
    city: "Ciudad de México",
    postalCode: "06000",
  });
  const norte = idOf(
    await api("POST", "/warehouses", {
      name: "Sucursal Norte",
      address: "Calz. Vallejo 850",
      city: "Ciudad de México",
      postalCode: "02300",
    }),
  );
  console.log("  · 2 sucursales");

  // ── Proveedores ────────────────────────────────────────────────────────
  const supplier = async (body: Json) => idOf(await api("POST", "/suppliers", body));
  const valle = await supplier({
    name: "Distribuidora del Valle",
    taxId: "DVA050101AB2",
    contactName: "Marta Gómez",
    phone: "+525555010203",
    email: "ventas.valle@example.com",
  });
  const lacteos = await supplier({
    name: "Lácteos San Juan",
    taxId: "LSJ100520KH7",
    contactName: "Pedro Ruiz",
    phone: "+525555040506",
    email: "pedidos.sanjuan@example.com",
  });
  await supplier({ name: "Abarrotera Central", contactName: "Rosa Méndez" });
  console.log("  · 3 proveedores");

  // ── Productos ──────────────────────────────────────────────────────────
  // El abarrotes acomoda por pasillos: con las ubicaciones encendidas, el
  // formulario de producto muestra su campo y la `location` de abajo se ve.
  await api("PATCH", "/tenants/me", { usesLocations: true });
  /**
   * El precio de lista de cada cosa que se vende, por su id (el de la
   * presentación cuando la hay): con él se calcula el total de una venta en
   * efectivo ANTES de cobrarla, para mandar con cuánto paga el cliente.
   */
  const precioDe: Record<string, number> = {};
  const conPrecio = (id: string, body: Json) => {
    precioDe[id] = Number(body.price);
    return id;
  };
  const product = async (body: Json) => conPrecio(idOf(await api("POST", "/products", body)), body);
  const presentation = async (productId: string, body: Json) =>
    conPrecio(idOf(await api("POST", `/products/${productId}/presentations`, body)), body);
  const agua = await product({
    sku: "AGUA-1L",
    name: "Agua natural 1 L",
    barcode: ean13("750105530001"),
    price: 14,
    cost: 8.5,
    stockMin: 24,
    location: "Pasillo 1",
  });
  const cajaAgua = await presentation(agua, {
    name: "Caja con 12",
    factor: 12,
    price: 150,
    cost: 102,
  });
  const queso = await product({
    sku: "QUESO-MOZ",
    name: "Queso mozzarella",
    baseUnit: "kg",
    price: 210,
    cost: 140,
    stockMin: 2,
    location: "Refrigerador",
  });
  const porcionQueso = await presentation(queso, {
    name: "Porción 250 g",
    factor: 0.25,
    price: 52.5,
  });
  const aceite = await product({
    sku: "ACEITE-500",
    name: "Aceite de oliva 500 ml",
    barcode: ean13("750999900001"),
    price: 161.4,
    cost: 118,
    stockMin: 6,
    location: "Pasillo 2",
  });
  const leche = await product({
    sku: "LECHE-1L",
    name: "Leche entera 1 L",
    barcode: ean13("750999900002"),
    price: 28,
    cost: 21.5,
    stockMin: 12,
    tracksLots: true,
    location: "Refrigerador",
  });
  const galletas = await product({
    sku: "GALL-AVENA",
    name: "Galletas de avena 170 g",
    barcode: ean13("750999900003"),
    price: 24.9,
    cost: 16,
    stockMin: 12,
    location: "Pasillo 3",
  });
  const refresco = await product({
    sku: "REF-COLA-600",
    name: "Refresco de cola 600 ml",
    barcode: ean13("750999900004"),
    price: 19.5,
    cost: 12,
    stockMin: 24,
    location: "Pasillo 1",
  });
  const frijol = await product({
    sku: "FRIJOL-NEGRO",
    name: "Frijol negro a granel",
    baseUnit: "kg",
    price: 38,
    cost: 26,
    stockMin: 5,
    location: "Pasillo 4",
  });
  const pan = await product({
    sku: "PAN-CAJA",
    name: "Pan de caja grande",
    barcode: ean13("750999900005"),
    price: 52,
    cost: 38,
    stockMin: 6,
    location: "Pasillo 3",
  });
  // Dos que el panel debe señalar: el café queda bajo su mínimo desde que
  // llega, y el atún se vende hasta agotarse.
  const cafe = await product({
    sku: "CAFE-200",
    name: "Café soluble 200 g",
    barcode: ean13("750999900006"),
    price: 89,
    cost: 64,
    stockMin: 8,
    location: "Pasillo 2",
  });
  const atun = await product({
    sku: "ATUN-140",
    name: "Atún en agua 140 g",
    barcode: ean13("750999900007"),
    price: 24,
    cost: 16.5,
    stockMin: 10,
    location: "Pasillo 2",
  });
  const despensa = await product({
    sku: "DESPENSA",
    name: "Despensa básica",
    isComposite: true,
    price: 250,
  });
  await api("POST", `/products/${despensa}/composition`, {
    lines: [
      { componentId: agua, quantity: 2 },
      { componentId: aceite, quantity: 1 },
      { componentId: frijol, quantity: 1 },
      { componentId: galletas, quantity: 1 },
    ],
  });
  console.log("  · 11 productos, con caja de 12, venta por peso, lotes y un kit");

  // ── Servicios ──────────────────────────────────────────────────────────
  const service = async (body: Json) => conPrecio(idOf(await api("POST", "/services", body)), body);
  const envio = await service({
    code: "ENVIO",
    name: "Envío a domicilio",
    description: "Entrega en un radio de 2 km.",
    price: 35,
    warehouseIds: [centro, norte],
  });
  const garrafon = await service({
    code: "GARRAFON",
    name: "Recarga de garrafón 20 L",
    price: 32,
    cost: 18,
    warehouseIds: [centro, norte],
  });
  console.log("  · 2 servicios");

  // ── Catálogos propios (Plus) ───────────────────────────────────────────
  const pasillos = idOf(await api("POST", "/catalogs", { name: "Pasillos" }));
  const nombre = await api<{ id: string; key: string }>("POST", `/catalogs/${pasillos}/fields`, {
    label: "Qué hay",
    fieldType: "text",
  });
  const pasillo: Record<string, string> = {};
  for (const [code, value] of [
    ["P1", "Bebidas"],
    ["P2", "Aceites y enlatados"],
    ["P3", "Pan y galletas"],
    ["P4", "Granos a granel"],
  ] as const) {
    pasillo[code] = idOf(
      await api("POST", `/catalogs/${pasillos}/records`, {
        code,
        attributes: { [nombre.key]: value },
      }),
    );
  }
  // Un campo propio en los productos que toma sus opciones del subcatálogo.
  const catalogos = items<{ id: string; systemKey?: string }>(await api("GET", "/catalogs"));
  const deProductos = catalogos.find((c) => c.systemKey === "products")?.id;
  if (!deProductos) throw new Error("No encontré el catálogo de sistema de productos.");
  const campoPasillo = await api<{ id: string; key: string }>(
    "POST",
    `/catalogs/${deProductos}/fields`,
    { label: "Pasillo", fieldType: "lookup", lookupCatalogId: pasillos },
  );
  for (const [productId, code] of [
    [agua, "P1"],
    [refresco, "P1"],
    [aceite, "P2"],
    [galletas, "P3"],
    [pan, "P3"],
    [frijol, "P4"],
  ] as const) {
    await api("PATCH", `/products/${productId}`, {
      attributes: { [campoPasillo.key]: pasillo[code] },
    });
  }
  console.log("  · el subcatálogo «Pasillos» y el campo «Pasillo» en los productos");

  // ── El equipo ──────────────────────────────────────────────────────────
  const roles = items<{ id: string; name: string }>(await api("GET", "/roles"));
  const vendedor = roles.find((r) => /seller|vendedor|cajero/i.test(r.name));
  if (!vendedor) throw new Error(`No encontré el rol de vendedor: ${roles.map((r) => r.name)}`);
  await api("POST", "/roles", {
    name: "Encargado de almacén",
    permissionCodes: ["products:read", "inventory:read", "inventory:movement"],
  });
  await api("POST", "/users", {
    email: CASHIER.email,
    firstName: CASHIER.firstName,
    lastName: CASHIER.lastName,
    locale: "es",
    roleIds: [vendedor.id],
    defaultWarehouseId: centro,
  });
  await http("POST", "/auth/reset-password", {
    token: await mailToken(stack, CASHIER.email),
    password: CASHIER.password,
  });
  console.log(`  · ${CASHIER.firstName} ${CASHIER.lastName}, cajero, aceptó su invitación`);

  // ── La historia, en orden: primero lo más viejo ─────────────────────────
  // El API fecha todo con la hora actual. Para que el negocio tenga un mes de
  // vida, cada cosa se crea en el orden en que habría pasado y al final UNA
  // sentencia la recorre a su día: así el saldo del kardex, que sigue el orden
  // de creación, coincide con el orden de las fechas.
  const shifts: string[] = [];
  const TZ = "America/Mexico_City";
  /** El instante `hh:mm` de hace `days` días, en la zona del negocio. */
  const at = (days: number, minutes: number) =>
    `((date_trunc('day', now() AT TIME ZONE '${TZ}') - interval '${days} days' + interval '${minutes} minutes') AT TIME ZONE '${TZ}')`;
  const shiftDocument = (id: string, days: number, minutes: number) => {
    shifts.push(
      `UPDATE inventory_documents SET created_at = ${at(days, minutes)}, confirmed_at = ${at(days, minutes + 5)}, updated_at = ${at(days, minutes + 5)} WHERE id = '${id}';`,
      `UPDATE stock_movements SET created_at = ${at(days, minutes + 5)} WHERE document_id = '${id}';`,
    );
  };
  /** Un turno completo a su día: abre 8:45, una venta cada `step` min desde las 9:00, cierra al final. */
  const shiftSession = (id: string, days: number, count: number) => {
    const step = Math.max(10, Math.floor(660 / Math.max(count, 1)));
    shifts.push(
      `WITH s AS (SELECT id, row_number() OVER (ORDER BY created_at, folio) AS n FROM sales WHERE cashbox_session_id = '${id}') UPDATE sales SET created_at = ${at(days, 540)} + (s.n - 1) * interval '${step} minutes' FROM s WHERE sales.id = s.id;`,
      `UPDATE sale_items SET created_at = sales.created_at FROM sales WHERE sale_items.sale_id = sales.id AND sales.cashbox_session_id = '${id}';`,
      `UPDATE stock_movements SET created_at = sales.created_at FROM sales WHERE stock_movements.sale_id = sales.id AND sales.cashbox_session_id = '${id}';`,
      `UPDATE cashbox_sessions SET opened_at = ${at(days, 525)}, created_at = ${at(days, 525)}, closed_at = (SELECT max(created_at) FROM sales WHERE cashbox_session_id = '${id}') + interval '25 minutes', updated_at = (SELECT max(created_at) FROM sales WHERE cashbox_session_id = '${id}') + interval '25 minutes' WHERE id = '${id}';`,
    );
  };

  // Números pseudoaleatorios con semilla fija: el manual sale igual cada vez.
  let semilla = 20260924;
  const azar = () => {
    semilla = (semilla * 1103515245 + 12345) % 2147483648;
    return semilla / 2147483648;
  };
  const entre = (min: number, max: number) => min + Math.floor(azar() * (max - min + 1));

  const documento = async (
    type: "entry" | "exit" | "physical_count",
    warehouseId: string,
    header: Json,
    lines: Json[],
    confirm = true,
  ) => {
    const id = idOf(await api("POST", "/inventory/documents", { type, warehouseId }));
    if (Object.keys(header).length > 0) await api("PATCH", `/inventory/documents/${id}`, header);
    for (const line of lines) await api("POST", `/inventory/documents/${id}/lines`, line);
    if (confirm) await api("POST", `/inventory/documents/${id}/confirm`, {});
    return id;
  };

  // 1. El surtido inicial, a principios de mes (hace 22 días).
  const existencias: Record<string, number> = {
    [agua]: 1200,
    [queso]: 60,
    [aceite]: 150,
    [galletas]: 420,
    [refresco]: 900,
    [frijol]: 200,
    [pan]: 260,
    [cafe]: 6,
    [atun]: 12,
  };
  const inicial = await documento(
    "entry",
    centro,
    { reasonCode: "invoice", reference: "Factura A-0987" },
    [
      { productId: agua, quantity: existencias[agua], unitCost: 8.5 },
      { productId: queso, quantity: existencias[queso], unitCost: 140 },
      { productId: aceite, quantity: existencias[aceite], unitCost: 118 },
      { productId: leche, quantity: 220, unitCost: 21.5, lotCode: "L-0924", expiresAt: today(6) },
      { productId: leche, quantity: 260, unitCost: 21.5, lotCode: "L-1015", expiresAt: today(40) },
      { productId: galletas, quantity: existencias[galletas], unitCost: 16 },
      { productId: refresco, quantity: existencias[refresco], unitCost: 12 },
      { productId: frijol, quantity: existencias[frijol], unitCost: 26 },
      { productId: pan, quantity: existencias[pan], unitCost: 38 },
      { productId: cafe, quantity: existencias[cafe], unitCost: 64 },
      { productId: atun, quantity: existencias[atun], unitCost: 16.5 },
    ],
  );
  existencias[leche] = 480;
  shiftDocument(inicial, 22, 480);
  const inicialNorte = await documento(
    "entry",
    norte,
    { reasonCode: "invoice", reference: "Factura A-0988" },
    [
      { productId: agua, quantity: 48, unitCost: 8.5 },
      { productId: refresco, quantity: 48, unitCost: 12 },
      { productId: galletas, quantity: 24, unitCost: 16 },
      { productId: leche, quantity: 12, unitCost: 21.5, lotCode: "L-1015", expiresAt: today(40) },
    ],
  );
  shiftDocument(inicialNorte, 22, 500);
  console.log("  · el surtido inicial de las dos sucursales");

  // 2. Veinte días de ventas, un turno del cajero por día.
  //
  // En efectivo, el cliente paga con billetes y la venta guarda con cuánto
  // (F10-MANFIX-15): el ticket imprime Recibido y Cambio. El total se calcula
  // aquí como lo cobra el API en un negocio con el impuesto incluido —cada
  // renglón al centavo, menos el descuento— y se compara con el que responde:
  // si un precio cambia arriba y aquí no, el manual no se arma con un cambio
  // inventado.
  const totalDe = (lines: Json[], descuento = 0) => {
    const centavos = lines.reduce<number>((acc, line) => {
      const id = String(line.presentationId ?? line.productId ?? line.serviceId);
      const precio = precioDe[id];
      if (precio === undefined) throw new Error(`No sé el precio de ${id} para cobrarlo.`);
      return acc + Math.round(precio * Number(line.quantity) * 100);
    }, 0);
    return (centavos - Math.round(descuento * 100)) / 100;
  };
  /** Con qué paga alguien en el mostrador: un billete de $20, $50 o $100, o las centenas que alcancen. */
  const conBilletes = (total: number) =>
    total <= 20 ? 20 : total <= 50 ? 50 : total <= 100 ? 100 : Math.ceil(total / 100) * 100;
  const cobrarVenta = async (
    token: string,
    paymentMethod: string,
    lines: Json[],
    extra: Json = {},
  ) => {
    const descuento = Number((extra.discount as { amount?: number } | undefined)?.amount ?? 0);
    const total = paymentMethod === "cash" ? totalDe(lines, descuento) : null;
    const venta = await http<{ id: string; total: string }>(
      "POST",
      "/pos/sales",
      {
        paymentMethod,
        lines,
        ...extra,
        ...(total !== null && { cashReceived: conBilletes(total) }),
      },
      token,
      idempotency(),
    );
    if (total !== null && Number(venta.total) !== total) {
      throw new Error(
        `El seed calculó ${total} y el API cobró ${venta.total}: revisa los precios.`,
      );
    }
    return venta;
  };
  const vender = (token: string, paymentMethod: string, lines: Json[]) =>
    cobrarVenta(token, paymentMethod, lines);
  /**
   * Una venta de mostrador: de una a tres cosas, con lo que más se vende
   * saliendo más seguido. Cada venta deja una reserva de 60 en la sucursal
   * para lo que viene después (la merma, los traspasos); el atún no, para que
   * se agote.
   */
  const reserva = (productId: string) => (productId === atun ? 0 : 60);
  const surtido: { weight: number; line: [string, () => number, string?] }[] = [
    { weight: 5, line: [agua, () => entre(1, 3)] },
    { weight: 5, line: [refresco, () => entre(1, 3)] },
    { weight: 3, line: [galletas, () => entre(1, 2)] },
    { weight: 3, line: [pan, () => 1] },
    { weight: 4, line: [leche, () => entre(1, 2)] },
    { weight: 2, line: [queso, () => 0.25, porcionQueso] },
    { weight: 2, line: [frijol, () => entre(1, 4) / 2] },
    { weight: 1, line: [aceite, () => 1] },
    { weight: 0.4, line: [agua, () => 12, cajaAgua] },
    { weight: 0.5, line: [atun, () => entre(1, 2)] },
  ];
  const pesoTotal = surtido.reduce((acc, s) => acc + s.weight, 0);
  const elegir = () => {
    let x = azar() * pesoTotal;
    for (const s of surtido) {
      x -= s.weight;
      if (x <= 0) return s.line;
    }
    return (surtido[0] as (typeof surtido)[number]).line;
  };
  const ticket = (): Json[] => {
    const lineas: Json[] = [];
    for (let k = entre(1, 3); k > 0; k -= 1) {
      const [productId, cantidadDe, presentationId] = elegir();
      const cantidad = cantidadDe();
      if (lineas.some((l) => l.productId === productId)) continue;
      if ((existencias[productId] ?? 0) - cantidad < reserva(productId)) continue;
      existencias[productId] = (existencias[productId] ?? 0) - cantidad;
      lineas.push(
        presentationId
          ? { productId, presentationId, quantity: 1 }
          : { productId, quantity: cantidad },
      );
    }
    return lineas.length > 0 ? lineas : ticket();
  };
  const metodo = () => {
    const x = azar();
    return x < 0.55 ? "cash" : x < 0.9 ? "card" : "transfer";
  };
  const cajero = await login(CASHIER.email, CASHIER.password);
  // Quien entra por invitación no aceptó los Términos y el Aviso de
  // privacidad al registrarse, como Ana: los acepta la primera vez que entra.
  // Sin esto, cada captura del cajero saldría con ese aviso encima.
  await http("POST", "/auth/accept-terms", undefined, cajero);
  // Luis abre cada turno con $500 de cambio en el cajón (el fondo inicial): el
  // arqueo los espera de vuelta al cerrar, junto con lo vendido en efectivo.
  const FONDO_DE_LUIS = 500;
  for (let dias = 20; dias >= 1; dias -= 1) {
    const turno = idOf(
      await http(
        "POST",
        "/pos/session",
        { warehouseId: centro, openingCash: FONDO_DE_LUIS },
        cajero,
      ),
    );
    const cuantas = entre(18, 30);
    for (let v = 0; v < cuantas; v += 1) await vender(cajero, metodo(), ticket());
    if (dias % 7 === 3) {
      // El kit descuenta sus componentes: se llevan en la cuenta.
      for (const [id, q] of [
        [agua, 2],
        [aceite, 1],
        [frijol, 1],
        [galletas, 1],
      ] as const) {
        existencias[id] = (existencias[id] ?? 0) - q;
      }
      await vender(cajero, "card", [
        { productId: despensa, quantity: 1 },
        { serviceId: envio, quantity: 1 },
      ]);
    }
    const { expectedCash } = await http<{ expectedCash: string }>(
      "GET",
      "/pos/session/totals",
      undefined,
      cajero,
    );
    // Un día faltaron $20 del cambio: el arqueo lo registra con su nota.
    const falto = dias === 9;
    await http(
      "POST",
      "/pos/session/close",
      {
        declaredCash: Number(expectedCash) - (falto ? 20 : 0),
        ...(falto ? { note: "Faltaron $20 del cambio." } : {}),
      },
      cajero,
    );
    shiftSession(turno, dias, cuantas + (dias % 7 === 3 ? 1 : 0));
  }
  console.log("  · 20 días de ventas, cada uno con su turno cerrado");

  // 3. Lo de esta semana: la merma, los traspasos y el conteo, hoy temprano.
  await documento(
    "exit",
    centro,
    { reasonCode: "loss", reasonNote: "Botellas rotas al descargar el pedido." },
    [{ productId: agua, quantity: 2 }],
  );
  // Un traspaso que ya llegó y otro en camino.
  await documento(
    "exit",
    centro,
    { reasonCode: "transfer", linkedWarehouseId: norte, reference: "Resurtido semanal" },
    [
      { productId: aceite, quantity: 6 },
      { productId: frijol, quantity: 5 },
    ],
  );
  const [llegado] = items<{ id: string }>(await api("GET", "/transfers?page=1&pageSize=20"));
  if (!llegado) throw new Error("El traspaso no apareció en la lista.");
  const recepcion = idOf(await api("POST", `/transfers/${llegado.id}/receipt-draft`));
  await api("POST", `/inventory/documents/${recepcion}/confirm`, {});
  await documento(
    "exit",
    centro,
    { reasonCode: "transfer", linkedWarehouseId: norte, reference: "Pedido para el fin de semana" },
    [{ productId: agua, quantity: 24 }],
  );
  console.log("  · 1 merma y 2 traspasos");

  // 4. Las compras de la semana.
  const compra = idOf(
    await api("POST", "/purchases", {
      supplierId: valle,
      warehouseId: centro,
      purchaseDate: today(-2),
    }),
  );
  await api("PATCH", `/purchases/${compra}`, { supplierInvoice: "A-1024" });
  await api("PUT", `/purchases/${compra}/lines`, {
    lines: [
      { productId: agua, quantity: 48, unitCost: 8.5 },
      { productId: refresco, quantity: 48, unitCost: 12 },
    ],
  });
  await api("POST", `/purchases/${compra}/confirm`, {});

  // Las órdenes de compra vienen en Plus, pero cada negocio decide si las usa
  // (Mi perfil › Datos del negocio): se encienden como lo haría la dueña.
  await api("PATCH", "/tenants/me", { usesPurchaseOrders: true });
  const orden = idOf(
    await api("POST", "/purchase-orders", {
      supplierId: lacteos,
      warehouseId: centro,
      orderDate: today(-1),
      expectedDate: today(3),
    }),
  );
  await api("PUT", `/purchase-orders/${orden}/lines`, {
    lines: [
      { productId: leche, quantity: 60, unitCost: 21.5 },
      { productId: queso, quantity: 5, unitCost: 140 },
    ],
  });
  await api("POST", `/purchase-orders/${orden}/issue`, {});
  const detalle = await api<{ lines: { id: string; productId: string }[] }>(
    "GET",
    `/purchase-orders/${orden}`,
  );
  const lineaLeche = detalle.lines.find((line) => line.productId === leche)?.id;
  if (!lineaLeche) throw new Error("La orden de compra no trae la línea de leche.");
  const recibo = idOf(await api("POST", `/purchase-orders/${orden}/receipts`, {}));
  await api("PUT", `/purchase-orders/${orden}/receipts/${recibo}/lines`, {
    lines: [
      { purchaseOrderLineId: lineaLeche, quantity: 36, lotCode: "L-1022", expiresAt: today(30) },
    ],
  });
  await api("POST", `/purchase-orders/${orden}/receipts/${recibo}/confirm`, {});
  console.log("  · 1 compra y 1 orden de compra con una recepción parcial");

  // 5. Los gastos del mes.
  const categorias = items<{ id: string; name: string; code?: string }>(
    await api("GET", "/expenses/categories?page=1&pageSize=100"),
  );
  const categoria = (pattern: RegExp) => {
    const found = categorias.find((c) => pattern.test(`${c.code ?? ""} ${c.name}`));
    if (!found) {
      throw new Error(
        `No hay categoría de gasto que diga ${pattern}: ${categorias.map((c) => c.name).join(", ")}`,
      );
    }
    return found.id;
  };
  await api("POST", "/expenses", {
    warehouseId: centro,
    expenseDate: today(-5),
    categoryId: categoria(/renta|rent/i),
    beneficiary: "Inmobiliaria Roma",
    description: "Renta del local de septiembre",
    amount: 4500,
    paymentMethod: "transfer",
    paidAt: new Date(Date.now() - 5 * 86_400_000).toISOString(),
  });
  await api("POST", "/expenses", {
    warehouseId: centro,
    expenseDate: today(-1),
    categoryId: categoria(/luz|electric|servicios|utilit/i),
    beneficiary: "Compañía de luz",
    description: "Recibo de luz del bimestre",
    amount: 680,
    dueDate: today(6),
  });
  console.log("  · 2 gastos: uno pagado y uno por pagar");

  // 6. Hoy: el turno de la dueña, abierto, con las ventas de la mañana.
  const turnoHoy = idOf(await http("POST", "/pos/session", { warehouseId: centro }, t));
  for (let v = 0; v < 9; v += 1) await vender(t, metodo(), ticket());
  // Repartidas desde las 8:00, una cada 12 min: la gráfica por hora del panel
  // las muestra como una mañana y no como nueve ventas en el mismo minuto.
  // Nunca en el futuro: si el manual se genera antes de las 10, se juntan
  // antes de la hora actual (el panel no cuenta lo que todavía no pasa).
  shifts.push(
    `WITH s AS (SELECT id, row_number() OVER (ORDER BY created_at, folio) AS n FROM sales WHERE cashbox_session_id = '${turnoHoy}') UPDATE sales SET created_at = LEAST(${at(0, 480)} + (s.n - 1) * interval '12 minutes', now() - (10 - s.n) * interval '3 minutes') FROM s WHERE sales.id = s.id;`,
    `UPDATE sale_items SET created_at = sales.created_at FROM sales WHERE sale_items.sale_id = sales.id AND sales.cashbox_session_id = '${turnoHoy}';`,
    `UPDATE stock_movements SET created_at = sales.created_at FROM sales WHERE stock_movements.sale_id = sales.id AND sales.cashbox_session_id = '${turnoHoy}';`,
    `UPDATE cashbox_sessions SET opened_at = LEAST(${at(0, 465)}, (SELECT min(created_at) FROM sales WHERE cashbox_session_id = '${turnoHoy}') - interval '15 minutes'), created_at = LEAST(${at(0, 465)}, (SELECT min(created_at) FROM sales WHERE cashbox_session_id = '${turnoHoy}') - interval '15 minutes') WHERE id = '${turnoHoy}';`,
  );
  console.log("  · hoy: el turno de la dueña, abierto, con 9 ventas");

  // Lo que quedó a medias: una salida sin confirmar y un conteo en curso. Van
  // DESPUÉS de las ventas de hoy, porque el conteo compara con la existencia
  // de este momento: creado antes, esas ventas se volverían diferencias.
  await documento(
    "exit",
    centro,
    { reasonCode: "consumption", reasonNote: "Para la limpieza del local." },
    [{ productId: agua, quantity: 2 }],
    false,
  );
  // El conteo: lo que se contó difiere un poco de lo que dice el sistema.
  const galletasHoy = Math.round(existencias[galletas] ?? 0);
  await documento(
    "physical_count",
    centro,
    {},
    [
      { productId: galletas, counted: galletasHoy - 2 },
      { productId: refresco, counted: Math.round(existencias[refresco] ?? 0) },
      { productId: pan, counted: Math.round(existencias[pan] ?? 0) - 1 },
    ],
    false,
  );
  console.log("  · 1 salida en borrador y 1 conteo en curso");

  // 7. Hoy también cobra Luis, en SU turno de la Sucursal Centro: el turno es
  // de cada cajero, así que el suyo y el de Ana conviven en la misma
  // sucursal. Va DESPUÉS de todo lo anterior para no mover ningún folio de lo
  // que ya citan las capturas. Sus ventas no llevan galletas, refresco ni
  // pan: el conteo en curso compara contra la existencia de AHORA, y cada
  // pieza vendida de esas tres se le volvería diferencia. Alcanza de sobra:
  // lo que él vende cerró el mes con 60 o más (la reserva de `ticket()`), y
  // lo que más se lleva son 27 aguas.
  // En efectivo paga con billetes, como las demás (`cobrarVenta`): la última,
  // la del ticket del capítulo 7, suma $243.50 y el cliente paga con $300.
  const cobrar = (paymentMethod: string, lines: Json[], extra: Json = {}) =>
    cobrarVenta(cajero, paymentMethod, lines, extra);
  const cotizar = (lines: Json[], note: string) =>
    http<{ id: string; folio: string }>("POST", "/pos/quotes", { lines, note }, cajero);

  // La cotización que un cliente pidió anteayer y hoy viene a pagar.
  const pedido = await cotizar(
    [
      { productId: agua, presentationId: cajaAgua, quantity: 1 },
      { productId: aceite, quantity: 2 },
      { serviceId: envio, quantity: 1 },
    ],
    "Para una comida familiar; se entrega a domicilio.",
  );
  const turnoLuis = idOf(
    await http("POST", "/pos/session", { warehouseId: centro, openingCash: FONDO_DE_LUIS }, cajero),
  );
  await cobrar("cash", [
    { productId: agua, quantity: 3 },
    { serviceId: garrafon, quantity: 1 },
  ]);
  await cobrar("card", [
    { productId: leche, quantity: 2 },
    { productId: queso, presentationId: porcionQueso, quantity: 1 },
  ]);
  const devuelta = idOf(
    await cobrar("cash", [
      { productId: aceite, quantity: 1 },
      { productId: frijol, quantity: 1 },
    ]),
  );
  // Se cobra como lo hace la caja: se piden sus líneas listas para cobrar, y
  // cada una viaja con el renglón de la cotización del que salió.
  const paraCobrar = await http<{
    id: string;
    lines: {
      presentationId: string | null;
      quantity: string;
      item: { type: string; id: string; quoteLineId?: string } | null;
    }[];
  }>("GET", `/pos/quotes/folio/${pedido.folio}/for-sale`, undefined, cajero);
  await cobrar(
    "card",
    paraCobrar.lines.map((line) => {
      if (line.item === null) {
        throw new Error(`La cotización ${pedido.folio} trae una línea que ya no se puede cobrar.`);
      }
      return {
        [line.item.type === "service" ? "serviceId" : "productId"]: line.item.id,
        ...(line.presentationId !== null && { presentationId: line.presentationId }),
        quoteLineId: line.item.quoteLineId,
        quantity: Number(line.quantity),
      };
    }),
    { quoteId: paraCobrar.id },
  );
  // Un gasto que salió de SU cajón. El rol Seller no registra gastos (le
  // falta `expenses:manage`): lo registra Ana y elige como caja de origen el
  // turno de Luis, como en el formulario de Gastos. Al cerrar, se le resta
  // del efectivo que su turno espera.
  const gastoDelCajon = idOf(
    await api("POST", "/expenses", {
      warehouseId: centro,
      expenseDate: today(),
      categoryId: categoria(/stationery|papeler/i),
      beneficiary: "Papelería San Pablo",
      description: "Rollos de papel térmico para la impresora de tickets",
      amount: 90,
      paymentMethod: "cash",
      cashboxSessionId: turnoLuis,
      notes: "Luis los pagó con el efectivo de su cajón.",
    }),
  );
  await cobrar("cash", [
    { productId: frijol, quantity: 1.5 },
    { productId: leche, quantity: 2 },
  ]);
  // Una cotización vigente, de varias cosas, que el cliente se lleva para volver.
  const vigente = await cotizar(
    [
      { productId: agua, presentationId: cajaAgua, quantity: 2 },
      { productId: refresco, quantity: 12 },
      { productId: aceite, quantity: 3 },
      { productId: queso, quantity: 1 },
      { serviceId: envio, quantity: 1 },
    ],
    "Para la fiesta del sábado. Llamar antes de enviar.",
  );
  // La última de la mañana, con un descuento autorizado con el código del
  // negocio. Es la que sale en el ticket del capítulo 7.
  await cobrar(
    "cash",
    [
      { productId: agua, presentationId: cajaAgua, quantity: 1 },
      { productId: queso, presentationId: porcionQueso, quantity: 1 },
      { productId: leche, quantity: 2 },
    ],
    { discount: { amount: 15, code: DEMO.discountCode, reason: "Cliente frecuente" } },
  );
  // Cancelar es de gestión (`pos:cancel`, que Seller no tiene): la cancela Ana.
  await api("POST", `/pos/sales/${devuelta}/cancel`, {
    reason: "El cliente devolvió la mercancía sin abrir.",
  });

  // Sus ventas, desde las 9:00 y una cada 20 min, con la regla de las de Ana:
  // nunca en el futuro. La cancelación, 15 min después de su venta, y su
  // reverso en el kardex a esa misma hora. La cotización cobrada se pidió
  // anteayer por la tarde y se cargó con la venta que la cobró; la vigente,
  // entre la quinta venta y la sexta; el gasto, entre la cuarta y la quinta.
  const deLuis = `sales.cashbox_session_id = '${turnoLuis}'`;
  const aperturaLuis = `LEAST(${at(0, 525)}, (SELECT min(created_at) FROM sales WHERE cashbox_session_id = '${turnoLuis}') - interval '15 minutes')`;
  const pagoDelGasto = `LEAST(${at(0, 610)}, now() - interval '7 minutes')`;
  shifts.push(
    `WITH s AS (SELECT id, row_number() OVER (ORDER BY created_at, folio) AS n FROM sales WHERE cashbox_session_id = '${turnoLuis}') UPDATE sales SET created_at = LEAST(${at(0, 540)} + (s.n - 1) * interval '20 minutes', now() - (7 - s.n) * interval '3 minutes') FROM s WHERE sales.id = s.id;`,
    `UPDATE sale_items SET created_at = sales.created_at FROM sales WHERE sale_items.sale_id = sales.id AND ${deLuis};`,
    `UPDATE stock_movements SET created_at = sales.created_at FROM sales WHERE stock_movements.sale_id = sales.id AND ${deLuis} AND stock_movements.reason_code = 'sale';`,
    `UPDATE sales SET canceled_at = LEAST(created_at + interval '15 minutes', now() - interval '1 minute') WHERE id = '${devuelta}';`,
    `UPDATE stock_movements SET created_at = sales.canceled_at FROM sales WHERE stock_movements.sale_id = sales.id AND sales.id = '${devuelta}' AND stock_movements.reason_code = 'sale_return';`,
    `UPDATE cashbox_sessions SET opened_at = ${aperturaLuis}, created_at = ${aperturaLuis} WHERE id = '${turnoLuis}';`,
    `UPDATE quotes SET created_at = ${at(2, 1050)}, loaded_at = sales.created_at FROM sales WHERE sales.quote_id = quotes.id AND quotes.id = '${pedido.id}';`,
    `UPDATE quotes SET created_at = LEAST(${at(0, 630)}, now() - interval '5 minutes') WHERE id = '${vigente.id}';`,
    `UPDATE expenses SET created_at = ${pagoDelGasto}, paid_at = ${pagoDelGasto}, updated_at = ${pagoDelGasto} WHERE id = '${gastoDelCajon}';`,
  );
  console.log(
    `  · hoy: el turno de ${CASHIER.firstName}, abierto, con 6 ventas (una cancelada), 2 cotizaciones y un gasto de su cajón`,
  );

  // 8. Cada cosa a su día. Los documentos confirmados y los movimientos
  // tienen candados en la base que impiden modificarlos, y está bien que los
  // tengan: en un negocio real nadie reescribe el pasado. En la base del
  // manual, que es desechable, se apagan solo mientras corre este ajuste
  // (`session_replication_role = replica`, lo mismo que usa `purge_tenant`).
  stack.sql(
    [
      "SET session_replication_role = replica;",
      ...shifts,
      "SET session_replication_role = origin;",
    ].join("\n"),
  );
  console.log("  · cada movimiento en su fecha");
}
