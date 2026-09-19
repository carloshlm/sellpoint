// El texto MAESTRO del sitio: español neutro, de tú (SITIO-WEB-CONTENIDO.md §4).
// Los demás idiomas se comparan contra este archivo: `test/i18n.test.ts` falla
// si a alguno le falta —o le sobra— una clave.
//
// Las claves van en inglés; el valor, en el idioma de quien lo lee. Aquí va lo
// que comparten todas las versiones en español; lo que cambia de un país a
// otro vive en `../overrides.ts`.
//
// En los titulares de beneficios, la palabra que se subraya va entre
// *asteriscos*: quien traduce decide cuál es en su idioma.
export const es = {
  meta: {
    title: "SellPointy — Punto de venta, inventario y compras en un solo lugar",
    description:
      "Vende, controla tu inventario y compra mejor desde una sola pantalla, sin instalar nada. Pruébalo 14 días con todas las funciones, sin tarjeta.",
  },
  a11y: {
    skipToContent: "Saltar al contenido",
  },
  nav: {
    label: "Principal",
    home: "SellPointy, ir al inicio",
    whatItDoes: "Qué hace",
    benefits: "Beneficios",
    plans: "Planes",
    faq: "Preguntas",
    login: "Iniciar sesión",
    cta: "Empieza gratis",
    // El mismo botón en el menú del celular, donde el renglón es angosto. En
    // español e inglés cabe entero; el francés lo acorta.
    ctaShort: "Empieza gratis",
    openMenu: "Abrir menú",
    closeMenu: "Cerrar menú",
  },
  hero: {
    // Un renglón por elemento. El último termina en el punto amarillo, que
    // reemplaza al punto tipográfico: por eso ninguno lo lleva escrito.
    headline: ["Tus ventas son el punto"],
    lead: "Punto de venta, inventario y compras en un solo lugar. Escanea, cobra y lleva el control de tu negocio desde la caja o desde tu celular.",
    primaryCta: "Empieza gratis",
    secondaryCta: "Ver qué hace",
    trustLine: "14 días con todas las funciones. Sin tarjeta y sin instalar nada.",
    // La caja dibujada. Los importes y el código de barras son del PAÍS y viven
    // en `config/page.ts`; aquí va solo lo que se lee.
    mock: {
      label: "Ejemplo de una venta en SellPointy",
      badge: "¡Escaneado!",
      title: "Venta en curso",
      register: "Caja 1",
      total: "Total",
      pay: "Cobrar",
      items: {
        first: { name: "Agua natural 1 L", detail: "2 piezas" },
        second: { name: "Galletas de avena 170 g", detail: "1 pieza" },
        third: { name: "Aceite de oliva 500 ml", detail: "1 pieza" },
      },
    },
  },
  /** Desde qué plan es verdad una promesa. Sin etiqueta = todos los planes. */
  planTags: {
    fromPro: "Desde Pro",
    onPlus: "En Plus",
  },
  whatItDoes: {
    eyebrow: "Qué hace",
    title: "Todo lo que pasa en tu mostrador, en una sola pantalla.",
    sub: "Deja de saltar entre la libreta, el Excel y la calculadora. SellPointy une lo que vendes con lo que tienes y lo que compras.",
    items: {
      sell: {
        title: "Vende",
        text: "Cobra con lector de códigos, pistola Bluetooth o la cámara de tu celular. Tickets con tu logo y turno de caja con arqueo, para cerrar el día sin sorpresas.",
      },
      track: {
        title: "Controla",
        text: "Entradas, salidas, traspasos e inventario físico. El historial de cada producto, en todos tus almacenes.",
      },
      buy: {
        title: "Compra",
        text: "Registra tus compras con su factura y mantén tus costos al día, para que el precio que pones deje la ganancia que esperas.",
      },
      decide: {
        title: "Decide",
        text: "Reportes de ventas y gastos, listos para leer y para exportar. Sin armar nada a mano.",
      },
    },
  },
  benefits: {
    eyebrow: "Beneficios para tu negocio",
    title: "Menos tiempo en el sistema. Más tiempo vendiendo.",
    items: {
      fast: {
        title: "Cobra en *segundos*, no en filas.",
        text: "Escaneas y el producto ya está en la cuenta. Nadie espera mientras buscas un precio.",
      },
      catalog: {
        title: "Da de alta tu catálogo en *una tarde*.",
        text: "Escanea el código y SellPointy reconoce el producto y te sugiere su nombre; tú solo pones el precio. ¿Ya lo tienes en Excel? Súbelo de un jalón.",
      },
      shift: {
        title: "Cierra la caja *sin sorpresas*.",
        text: "Cada turno abre y cierra con su arqueo. Sabes quién cobró, cuánto y si cuadra.",
      },
      stock: {
        title: "Sabe *cuánto tienes*, sin contar a mano.",
        text: "Cada venta descuenta del almacén y cada compra lo repone. Tus existencias son un número, no una corazonada.",
      },
      expiry: {
        title: "Que nada se te *caduque* en el anaquel.",
        text: "Lotes con fecha y un aviso claro de lo que está por vencer, para venderlo a tiempo en lugar de tirarlo.",
      },
      pocket: {
        title: "Tu negocio completo, *en tu bolsillo*.",
        text: "Computadora, tablet o celular. Entras desde donde estés y ves lo mismo que en la caja.",
      },
    },
  },
  whoFor: {
    eyebrow: "Para quién",
    title: "Hecho para el negocio que atiendes tú.",
    trades: [
      "Abarrotes",
      "Farmacias",
      "Minisúper",
      "Ferreterías",
      "Tlapalerías",
      "Papelerías",
      "Boutiques",
      "Refaccionarias",
      "Dulcerías",
      "Tiendas naturistas",
    ],
    // Solo se muestra donde `CLINICS_MARKETS` lo diga (hoy, México), y es la
    // única píldora que es un enlace: el módulo es de Premium, a la medida.
    clinics: "Consultorios",
  },
  faq: {
    eyebrow: "Preguntas",
    title: "Lo que todos preguntan antes de empezar.",
    items: {
      install: {
        q: "¿Tengo que instalar algo?",
        a: "No. SellPointy funciona en el navegador de tu computadora, tablet o celular. Entras con tu correo y listo.",
      },
      scanner: {
        q: "¿Qué lector de códigos necesito?",
        a: "Cualquiera: los lectores USB y las pistolas Bluetooth funcionan al conectarlos. Y si no tienes uno, la cámara de tu celular o tablet también escanea.",
      },
      spreadsheet: {
        q: "¿Puedo subir los productos que ya tengo en Excel?",
        a: "Sí. Descargas la plantilla, pegas tus productos y los subes de una vez. Y los que tengan código de barras los puedes dar de alta escaneándolos.",
      },
      trialEnd: {
        q: "¿Qué pasa cuando terminan los 14 días?",
        a: "Eliges el plan que te convenga. Si todavía no te decides, tu información no se borra: sigue ahí esperándote.",
      },
      payment: {
        q: "¿Cómo se paga?",
        a: "Por transferencia, cada mes o por año. Si pagas el año completo, pagas 10 meses y usas 12.",
      },
      changePlan: {
        q: "¿Puedo cambiar de plan después?",
        a: "Sí. Nos escribes desde la pantalla «Mi plan» de tu cuenta, nos dices a cuál quieres pasar y lo activamos.",
      },
      data: {
        q: "¿Mi información es mía?",
        a: "Sí. Tus ventas, tus precios, tus clientes y tus existencias son solo tuyos: no se comparten ni se venden. Lo único común es el catálogo de códigos de barras —el nombre que viene impreso en el empaque—, que es lo que te permite dar de alta un producto con solo escanearlo.",
      },
      languages: {
        q: "¿En qué idiomas está?",
        a: "En español y en inglés. Cada persona de tu equipo elige el suyo.",
      },
      // Las tres que siguen solo van en un mercado (`FAQ_ORDER`). Las de
      // Estados Unidos se leen en `/es-us/`; la de Canadá hoy no tiene versión
      // en español, pero la clave existe para que los tres idiomas coincidan.
      staffLanguage: {
        q: "¿Mi equipo puede usarlo en inglés?",
        a: "Sí. Cada persona elige su idioma, español o inglés, en la misma cuenta.",
      },
      salesTax: {
        q: "¿Los impuestos de venta ya vienen configurados?",
        a: "Al crear tu cuenta, SellPointy te deja lista la tasa base de impuesto de tu estado. Si tu ciudad o tu condado agrega la suya, la ajustas una vez y listo.",
      },
      canadaTax: {
        q: "¿Los impuestos ya vienen configurados?",
        a: "Al crear tu cuenta, SellPointy configura el GST, el HST o el PST de tu provincia. Los puedes ajustar cuando quieras.",
      },
    },
  },
  closing: {
    title: "Ponle punto final al desorden.",
    text: "Crea tu cuenta, escanea tus primeros productos y haz tu primera venta hoy mismo. Y si prefieres platicarlo antes, escríbenos.",
    primaryCta: "Empieza gratis",
    secondaryCta: "Escríbenos",
  },
  footer: {
    tagline: "Tus ventas son el punto.",
    navLabel: "Pie de página",
  },
  /** Los países, como se dicen en ESTE idioma. Los idiomas no: esos van en el suyo. */
  markets: {
    mx: "México",
    us: "Estados Unidos",
    ca: "Canadá",
  },
  geo: {
    switcher: {
      // Lo lee el lector de pantalla antes del país y el idioma actuales.
      label: "País e idioma",
    },
    // El aviso de la raíz habla el idioma de la versión que OFRECE, no el de la
    // página: por eso cada idioma trae la pregunta para los tres países.
    notice: {
      question: {
        mx: "¿Estás en México?",
        us: "¿Estás en Estados Unidos?",
        ca: "¿Estás en Canadá?",
      },
      link: {
        mx: "Ver el sitio para México",
        us: "Ver el sitio para Estados Unidos",
        ca: "Ver el sitio para Canadá",
      },
      close: "Cerrar aviso",
    },
  },
};

/** La forma que todo idioma tiene que cumplir: la del maestro, con texto libre. */
type Widen<T> = T extends string
  ? string
  : T extends readonly string[]
    ? string[]
    : { [K in keyof T]: Widen<T[K]> };

export type Messages = Widen<typeof es>;
