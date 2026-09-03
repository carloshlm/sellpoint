import { buildTurnTicketDefinition, type TurnTicketInput } from "./turn-ticket.renderer";

/**
 * El papel del turno (Carlos, 2026-09-02): una tira térmica, como el ticket
 * de venta, con el número en grande, el nombre del negocio y la fecha y hora
 * en que se generó — todo centrado. Se testea el `docDefinition`, no el
 * binario: lo que importa es QUÉ dice el papel.
 */
describe("buildTurnTicketDefinition", () => {
  const t = (key: string) => key;
  const base: TurnTicketInput = {
    tenant: { name: "Mi Negocio", legalName: "CLÍNICA DEL NORTE S.A. DE C.V." },
    number: 5,
    customerName: "Rosa Luna Ríos",
    createdAt: new Date("2026-09-03T04:30:00.000Z"), // 2-sep 22:30 en CDMX
    timeZone: "America/Mexico_City",
    locale: "es",
    width: "58mm",
  };
  const textos = (def: unknown) => JSON.stringify(def);

  it("sale del ancho pedido, con alto automático y TODO centrado", () => {
    const def = buildTurnTicketDefinition(base, t) as {
      pageSize: { width: number; height: string };
      content: { alignment?: string }[];
    };
    expect(def.pageSize.height).toBe("auto");
    const ancho = buildTurnTicketDefinition({ ...base, width: "80mm" }, t) as {
      pageSize: { width: number };
    };
    expect(ancho.pageSize.width).toBeGreaterThan(def.pageSize.width);
    // Ninguna línea de texto se alinea a la izquierda: es un papel para leer de frente.
    for (const bloque of def.content) {
      if ("text" in bloque) {
        expect(bloque.alignment).toBe("center");
      }
    }
  });

  it("dice el negocio, TURNO, el número en grande, el cliente y cuándo se generó", () => {
    const def = buildTurnTicketDefinition(base, t) as {
      content: { text?: unknown; fontSize?: number; bold?: boolean }[];
    };
    const numero = def.content.find((b) => b.text === "5");
    expect(numero?.bold).toBe(true);
    expect(numero?.fontSize).toBeGreaterThanOrEqual(40);
    const json = textos(def);
    expect(json).toContain("CLÍNICA DEL NORTE S.A. DE C.V.");
    expect(json).toContain("ticket.turn");
    expect(json).toContain("Rosa Luna Ríos");
    expect(json).toContain("ticket.turnFooter");
    // La fecha en el calendario del NEGOCIO: 2 de septiembre, no 3 (UTC).
    expect(json).toMatch(/2\/9\/2026|02\/09\/26/);
    expect(json).toMatch(/10:30/);
  });

  it("sin cliente, no inventa una línea vacía", () => {
    const def = buildTurnTicketDefinition({ ...base, customerName: null }, t) as {
      content: { text?: unknown }[];
    };
    expect(def.content.some((b) => b.text === "")).toBe(false);
    expect(textos(def)).not.toContain("Rosa");
  });

  it("en inglés la fecha se lee en su formato", () => {
    const json = textos(buildTurnTicketDefinition({ ...base, locale: "en" }, t));
    expect(json).toMatch(/9\/2\/26|9\/2\/2026/);
  });
});
