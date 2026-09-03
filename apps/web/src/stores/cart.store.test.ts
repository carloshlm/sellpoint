import type {
  LookupConceptItem,
  LookupProductItem,
  LookupQuoteItem,
  LookupServiceItem,
} from "@/lib/pos/api";
import {
  aLineasDeVenta,
  type CartProductLine,
  type CartServiceLine,
  excedeElStock,
  precioDeLinea,
  subtotalDelCarrito,
  totalDeLinea,
  useCartStore,
} from "./cart.store";

/**
 * F4-CART-02 — el carrito.
 *
 * Lo que se protege acá no es "que se puedan agregar cosas" sino las tres
 * reglas que hacen que un ticket cuadre: que escanear dos veces sume en vez de
 * duplicar el renglón, que la presentación escaneada sea la que se cobra, y
 * que la aritmética no se desvíe.
 */

const PIEZA = {
  id: "pres-pieza",
  name: "Pieza",
  factor: "1",
  price: "12.50",
  barcode: "7501234567001",
  isDefaultSale: true,
  allowFractionalInput: false,
};

const CAJA = {
  id: "pres-caja",
  name: "Caja ×12",
  factor: "12",
  price: "140.00",
  barcode: "7501234567002",
  isDefaultSale: false,
  allowFractionalInput: false,
};

const AGUA: LookupProductItem = {
  type: "product",
  matchedBy: "text",
  id: "prod-agua",
  sku: "AGUA",
  name: "Agua mineral",
  baseUnit: "unit",
  isComposite: false,
  available: "50",
  expired: "0",
  presentations: [PIEZA, CAJA],
  matchedPresentationId: null,
};

const MASAJE: LookupServiceItem = {
  type: "service",
  matchedBy: "service",
  id: "svc-masaje",
  code: "MAS",
  name: "Masaje",
  price: "400.00",
};

const COTIZACION: LookupQuoteItem = {
  type: "quote",
  matchedBy: "quote",
  id: "quote-1",
  folio: "COT-000001",
  status: "open",
  total: "500.00",
  lineCount: 2,
};

/** F4-CONCEPT-08: la línea de concepto llega SOLO desde una cotización cargada. */
const FLETE: LookupConceptItem = {
  type: "concept",
  matchedBy: "quote",
  id: "ql-flete",
  description: "Flete a domicilio",
  unitPrice: "150.00",
  sourceModule: null,
};

const carrito = () => useCartStore.getState();

describe("useCartStore (F4-CART-02)", () => {
  beforeEach(() => {
    useCartStore.getState().clear();
  });

  /**
   * F4-CONCEPT-08 — la tercera línea. Se identifica por la línea de la
   * cotización (`quoteLineId`): es lo que la venta manda, y lo único que
   * manda — el precio lo copia el servidor de la cotización.
   */
  describe("concepto", () => {
    it("agregar dos veces el mismo quoteLineId funde cantidades en un renglón", () => {
      carrito().add(FLETE, { quantity: "1" });
      carrito().add(FLETE, { quantity: "1" });

      expect(carrito().lines).toHaveLength(1);
      expect(carrito().lines[0]).toMatchObject({
        type: "concept",
        quoteLineId: "ql-flete",
        description: "Flete a domicilio",
        quantity: "2",
      });
    });

    it("pinta el precio del papel y nunca marca faltante", () => {
      carrito().add(FLETE);
      const linea = carrito().lines[0]!;

      expect(precioDeLinea(linea)).toBe("150.00");
      expect(totalDeLinea(linea)).toBe(150);
      expect(excedeElStock(linea)).toBe(false);
    });

    it("el payload lleva quoteLineId y cantidad, NUNCA precio ni descripción", () => {
      carrito().add(FLETE, { quantity: "2" });

      expect(aLineasDeVenta(carrito().lines)).toEqual([{ quoteLineId: "ql-flete", quantity: 2 }]);
    });
  });

  describe("agregar", () => {
    it("una línea de producto nace con la presentación PREDETERMINADA", () => {
      carrito().add(AGUA);

      const linea = carrito().lines[0] as CartProductLine;
      expect(linea.type).toBe("product");
      expect(linea.presentationId).toBe(PIEZA.id);
      expect(linea.quantity).toBe("1");
    });

    /**
     * ⚠ LA INVARIANTE. El código de barras identifica la PRESENTACIÓN. Escanear
     * la caja de 12 y que el carrito preseleccione la pieza cobraría una en vez
     * de doce, y nadie lo notaría hasta el arqueo.
     */
    it("escanear la CAJA preselecciona la caja, no la predeterminada", () => {
      carrito().add({ ...AGUA, matchedBy: "barcode", matchedPresentationId: CAJA.id });

      expect((carrito().lines[0] as CartProductLine).presentationId).toBe(CAJA.id);
    });

    it("escanear DOS VECES el mismo código suma, no duplica el renglón", () => {
      carrito().add(AGUA);
      carrito().add(AGUA);

      expect(carrito().lines).toHaveLength(1);
      expect(carrito().lines[0]?.quantity).toBe("2");
    });

    /**
     * La caja de 12 y la pieza suelta son DOS renglones del ticket: distinto
     * precio, distinta cantidad. Fundirlos perdería lo que el cliente se lleva.
     */
    it("el mismo producto en dos presentaciones son dos renglones", () => {
      carrito().add(AGUA);
      carrito().add(AGUA, { presentationId: CAJA.id });

      expect(carrito().lines).toHaveLength(2);
    });

    it("un servicio entra sin presentación", () => {
      carrito().add(MASAJE);

      const linea = carrito().lines[0];
      expect(linea?.type).toBe("service");
      expect(linea && "presentationId" in linea).toBe(false);
    });

    /**
     * Una cotización no es un renglón: se vuelca con F4-QUOTE-04, que agrega
     * SUS líneas. Inventar un renglón acá dejaría al ticket sin saber qué
     * imprimir.
     */
    it("una cotización NO se agrega como línea", () => {
      carrito().add(COTIZACION);

      expect(carrito().lines).toHaveLength(0);
    });

    it("un producto sin presentación vendible no entra", () => {
      carrito().add({ ...AGUA, presentations: [] });

      expect(carrito().lines).toHaveLength(0);
    });
  });

  describe("cantidades", () => {
    it("acepta el texto tal cual, incluido el estado a medio teclear", () => {
      carrito().add(AGUA);
      const key = carrito().lines[0]?.key as string;

      // `Number("12.")` es `12`: guardar un número borraría el punto recién
      // escrito en el mismo render.
      carrito().setQuantity(key, "12.");

      expect(carrito().lines[0]?.quantity).toBe("12.");
    });

    it("suma sin arrastrar el error de la coma flotante", () => {
      carrito().add(AGUA, { quantity: "0.1" });
      carrito().add(AGUA, { quantity: "0.2" });

      expect(0.1 + 0.2).not.toBe(0.3);
      expect(carrito().lines[0]?.quantity).toBe("0.3");
    });
  });

  describe("cambiar la presentación", () => {
    it("mueve la línea a la otra presentación", () => {
      carrito().add(AGUA);
      const key = carrito().lines[0]?.key as string;

      carrito().setPresentation(key, CAJA.id);

      expect(carrito().lines).toHaveLength(1);
      expect((carrito().lines[0] as CartProductLine).presentationId).toBe(CAJA.id);
    });

    /**
     * Dos renglones de "Caja ×12" en el mismo ticket son un error de captura
     * que el cajero tendría que corregir a mano.
     */
    it("si ya hay un renglón de esa presentación, los FUNDE", () => {
      carrito().add(AGUA, { presentationId: CAJA.id, quantity: "2" });
      carrito().add(AGUA, { presentationId: PIEZA.id, quantity: "3" });
      const dePieza = carrito().lines.find(
        (l) => (l as CartProductLine).presentationId === PIEZA.id,
      )?.key as string;

      carrito().setPresentation(dePieza, CAJA.id);

      expect(carrito().lines).toHaveLength(1);
      expect(carrito().lines[0]?.quantity).toBe("5");
    });

    it("ignora una presentación que no es de ese producto", () => {
      carrito().add(AGUA);
      const key = carrito().lines[0]?.key as string;

      carrito().setPresentation(key, "pres-de-otro-producto");

      expect((carrito().lines[0] as CartProductLine).presentationId).toBe(PIEZA.id);
    });
  });

  describe("quitar y limpiar", () => {
    it("quita solo el renglón pedido", () => {
      carrito().add(AGUA);
      carrito().add(MASAJE);
      const key = carrito().lines[0]?.key as string;

      carrito().remove(key);

      expect(carrito().lines).toHaveLength(1);
      expect(carrito().lines[0]?.type).toBe("service");
    });

    it("limpiar borra las líneas Y el vínculo con la cotización", () => {
      carrito().add(AGUA);
      carrito().setQuoteId("quote-1");

      carrito().clear();

      expect(carrito().lines).toHaveLength(0);
      expect(carrito().quoteId).toBeNull();
    });
  });

  describe("totales derivados", () => {
    it("el precio de una línea sale de SU presentación", () => {
      carrito().add(AGUA, { presentationId: CAJA.id });

      expect(precioDeLinea(carrito().lines[0] as CartProductLine)).toBe("140.00");
    });

    it("el importe de la línea es precio × cantidad", () => {
      carrito().add(AGUA, { quantity: "3" });

      expect(totalDeLinea(carrito().lines[0] as CartProductLine)).toBe(37.5);
    });

    it("el subtotal suma productos y servicios", () => {
      carrito().add(AGUA, { quantity: "2" }); // 25.00
      carrito().add(MASAJE); // 400.00

      expect(subtotalDelCarrito(carrito().lines)).toBe(425);
    });

    /**
     * El total tiene que coincidir con la suma de lo que el cliente lee
     * renglón por renglón. Redondear al final daría un centavo de diferencia
     * contra el papel, y esa discusión en el mostrador no la gana nadie.
     */
    it("el subtotal suma importes YA redondeados al centavo", () => {
      const conPrecioRaro = { ...PIEZA, price: "3.33" };
      carrito().add({ ...AGUA, presentations: [conPrecioRaro] }, { quantity: "1.5" });
      carrito().add(
        { ...AGUA, id: "otro", presentations: [{ ...conPrecioRaro, id: "p2" }] },
        { quantity: "1.5" },
      );

      // Cada renglón imprime 5.00 (4.995 redondeado). El total es 10.00.
      expect(subtotalDelCarrito(carrito().lines)).toBe(10);
    });

    it("una presentación sin precio no vuelve el total ilegible", () => {
      carrito().add({ ...AGUA, presentations: [{ ...PIEZA, price: null }] });

      expect(subtotalDelCarrito(carrito().lines)).toBe(0);
    });
  });

  describe("el aviso de faltante", () => {
    it("marca cuando se pide más de lo que hay, en unidad BASE", () => {
      // 5 cajas ×12 son 60 piezas y solo hay 50.
      carrito().add({ ...AGUA, matchedPresentationId: CAJA.id }, { quantity: "5" });

      expect(excedeElStock(carrito().lines[0] as CartProductLine)).toBe(true);
    });

    it("no marca cuando alcanza justo", () => {
      // 4 cajas son 48 de 50.
      carrito().add({ ...AGUA, matchedPresentationId: CAJA.id }, { quantity: "4" });

      expect(excedeElStock(carrito().lines[0] as CartProductLine)).toBe(false);
    });

    it("un servicio nunca falta: no sale del anaquel", () => {
      carrito().add(MASAJE, { quantity: "99" });

      expect(excedeElStock(carrito().lines[0] as CartServiceLine)).toBe(false);
    });
  });

  describe("el cuerpo del cobro", () => {
    /**
     * ⚠ La regla que hace imposible manipular lo que se cobra desde el
     * navegador: **ids y cantidades, nunca precios.** El API relee el catálogo.
     */
    it("manda ids y cantidades, NUNCA precios", () => {
      carrito().add(AGUA, { quantity: "2" });
      carrito().add(MASAJE);

      const lineas = aLineasDeVenta(carrito().lines);

      expect(lineas).toEqual([
        { productId: "prod-agua", presentationId: PIEZA.id, quantity: 2 },
        { serviceId: "svc-masaje", quantity: 1 },
      ]);
      for (const linea of lineas) {
        expect(JSON.stringify(linea)).not.toContain("price");
      }
    });

    it("una cantidad a medio teclear se convierte a número, no a NaN", () => {
      carrito().add(AGUA);
      const key = carrito().lines[0]?.key as string;
      carrito().setQuantity(key, "12.");

      // Un NaN se serializa a `null` en JSON y el API contestaría un 422 sobre
      // un campo faltante que nadie podría explicar mirando la pantalla.
      expect(aLineasDeVenta(carrito().lines)[0]?.quantity).toBe(12);
    });
  });
});
