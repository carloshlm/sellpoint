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
  // La foto del mostrador (PAGE-08). Promete solo lo que «Vende» ya dice:
  // escanear, cobrar y el ticket con tu logo.
  inAction: {
    eyebrow: "En tu mostrador",
    title: "Escanea, cobra y entrega el ticket.",
    sub: "Así se ve una venta con SellPointy: pasas el producto por el lector, aparece en pantalla con su precio y cobras. Sin teclear precios ni buscar en una lista.",
    steps: {
      scan: { title: "Escanea", text: "El producto entra a la cuenta con su nombre y su precio." },
      charge: { title: "Cobra", text: "El total se suma solo. Tú solo confirmas." },
      ticket: { title: "Entrega el ticket", text: "Con tu logo, listo para tu cliente." },
    },
    imageAlt:
      "Una cajera escanea una botella de agua con un lector de códigos; a su lado, una tablet muestra la venta en SellPointy y una impresora entrega el ticket.",
    caption: "Imagen ilustrativa.",
  },
  // El panel dibujado (PAGE-09). Es de TODOS los planes, y por eso no habla de
  // existencias: Basic no las lleva. Los importes viven en `config/page.ts`.
  insights: {
    eyebrow: "Tu panel",
    title: "Abre SellPointy y ve cómo va tu día.",
    sub: "Ventas, utilidad y tickets al momento, desde la caja o desde tu celular. Sin esperar al corte y sin armar un reporte.",
    points: [
      "Lo que vendiste hoy y en el mes, contra tu meta.",
      "Tu utilidad: lo que vendiste menos lo que te costó.",
      "Tus productos más vendidos y a qué hora vendes más.",
    ],
    note: "Incluido en todos los planes.",
    mock: {
      label: "Ejemplo del panel de SellPointy con las ventas del día y del mes",
      badge: "Al momento",
      title: "Panel",
      tabs: { today: "Hoy", week: "Esta semana", month: "Este mes" },
      today: "Ventas de hoy",
      month: "Ventas del mes",
      goal: "{percent}% de la meta",
      profit: "Utilidad del mes",
      tickets: "Tickets de hoy",
      average: "{amount} promedio",
      trend: "Ventas: mes actual vs. anterior",
      current: "Este mes",
      previous: "Mes anterior",
      hourly: "Ventas de hoy por hora",
      top: "Más vendidos",
      units: "{count} unidades",
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
  plans: {
    eyebrow: "Planes",
    title: "Empieza con lo que necesitas. Crece cuando quieras.",
    lead: "Todos los planes incluyen actualizaciones. Los primeros 14 días pruebas Plus completo, y después eliges.",
    // «Recomendado», no «El más elegido»: no hay datos de ventas que lo
    // respalden. Se recomienda Pro porque es el primero que cumple la promesa
    // central del producto: saber cuánto tienes.
    recommended: "Recomendado",
    users: "{count} usuarios",
    warehouseOne: "{count} almacén",
    warehouseMany: "{count} almacenes",
    cards: {
      basic: {
        tagline: "Para empezar a cobrar en orden",
        includes: "Incluye:",
        cta: "Quiero Basic",
        // Basic vende aunque el saldo sea negativo. Dicho de frente evita al
        // cliente enojado y, de paso, empuja a Pro.
        note: "Basic no lleva existencias. Si necesitas saber cuánto tienes, tu plan es Pro.",
      },
      pro: {
        tagline: "Para controlar tu inventario",
        includes: "Todo lo de Basic, más:",
        cta: "Quiero Pro",
      },
      plus: {
        tagline: "Para operar en serio",
        includes: "Todo lo de Pro, más:",
        cta: "Quiero Plus",
      },
    },
    premium: {
      text: "¿Tu negocio necesita algo a la medida? Módulos hechos para tu giro —recepción, consultorio médico y más—, con usuarios y almacenes sin límite.",
      cta: "Escríbenos",
    },
    // Solo se muestra en los idiomas que la aplicación todavía no habla
    // (`APP_MISSING_LANGUAGES`): hoy, el francés.
    appLanguageNote: "La aplicación está disponible en español y en inglés.",
    compare: {
      toggle: "Ver todo lo que incluye cada plan",
      feature: "Funcionalidad",
      planTabs: "Plan que se muestra",
      included: "Incluido",
      notIncluded: "No incluido",
    },
    // Los nombres de las líneas son LOS DE LA APLICACIÓN, tal cual:
    // `test/plans.test.ts` los compara con `apps/web/src/i18n`.
    lines: {
      pos: "Punto de venta y tickets",
      cashShift: "Turno de caja con arqueo",
      ticket: "Ticket con tu logo, en 58 u 80 mm",
      reports: "Reportes",
      reports_export: "Exportar reportes",
      expenses: "Gastos",
      stockControl: "Control de inventario",
      movements: "Entradas, salidas y kardex",
      transfers: "Traspasos entre almacenes",
      quotes: "Cotizaciones",
      compositions: "Productos compuestos: recetas y kits",
      purchases: "Compras",
      purchase_orders: "Órdenes de compra y recepciones parciales",
      lots: "Lotes y caducidades",
      custom_fields: "Subcatálogos y campos propios",
      custom_roles: "Roles personalizados",
      custom_modules: "Módulos a la medida de tu negocio",
    },
    // Todo esto solo llega a la página con `showPrices` prendido (PLANS-04).
    prices: {
      cycleLabel: "Ciclo de pago",
      monthly: "Mensual",
      yearly: "Anual",
      perMonth: "/mes",
      perYear: "/año",
      // El anual cuesta diez meses: es una regla de la base, no una promoción.
      yearlyDeal: "Paga 10 meses, usa 12",
      pricesFor: {
        mx: "Precios para México.",
        us: "Precios para Estados Unidos.",
        ca: "Precios para Canadá.",
      },
      otherCountry: "¿Estás en otro país?",
      paidByTransfer: "Precios en {currency}. Se paga por transferencia.",
    },
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
      printer: {
        q: "¿Qué impresora de tickets necesito?",
        a: "Cualquier impresora térmica de 58 u 80 mm que tu computadora, tablet o celular reconozca: por USB, Bluetooth o red. SellPointy arma el ticket a la medida del papel y lo manda a imprimir desde el navegador, sin instalar programas. Y si no entregas tickets, no necesitas impresora: la venta queda registrada igual.",
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
  leadForm: {
    title: "Cuéntanos de tu negocio",
    // «Normalmente» es la palabra que hace el trabajo: describe cómo se
    // atiende, no promete un plazo (Carlos, 2026-09-18).
    lead: "Normalmente te escribimos en un día hábil, para ayudarte a elegir y arrancar.",
    name: "Nombre",
    email: "Correo",
    country: "País",
    otherCountry: "Otro país",
    plan: "Plan que te interesa",
    planOptions: {
      basic: "Basic",
      pro: "Pro",
      plus: "Plus",
      custom: "Algo a la medida",
      // A propósito: es el prospecto que más necesita que le escriban, y sin
      // esta salida elige uno al azar o se va.
      undecided: "Todavía no sé",
    },
    businessType: "Giro de tu negocio",
    businessTypeEmpty: "Elige uno (opcional)",
    businessTypeOther: "Otro",
    message: "¿Algo que debamos saber?",
    optional: "opcional",
    consent:
      "Acepto que SellPointy me escriba a este correo sobre mi solicitud. Puedo pedir que dejen de hacerlo cuando quiera.",
    privacyLink: "Aviso de privacidad",
    submit: "Enviar",
    sending: "Enviando…",
    // {name} y {email} se reemplazan con lo que escribió la persona.
    successTitle: "¡Listo, {name}!",
    successText:
      "Recibimos tu mensaje y te escribimos a {email}. Mientras tanto, puedes empezar tu prueba gratis — son 14 días con todo.",
    successCta: "Empezar mi prueba gratis",
    // `{email}` es el correo de contacto (`CONTACT_EMAIL`): quien no pudo enviar
    // el formulario no puede quedarse sin forma de escribir.
    error: "No pudimos enviar tu mensaje. Inténtalo de nuevo o escríbenos a {email}.",
    tooMany: "Recibimos varios mensajes desde tu conexión. Inténtalo de nuevo en un rato.",
    errors: {
      required: "Este dato es necesario.",
      email: "Revisa el correo: parece incompleto.",
      consent: "Necesitamos tu permiso para poder escribirte.",
    },
  },
  construction: {
    text: "Estamos preparando nuestro sitio. Mientras tanto, SellPointy ya funciona: entra a tu cuenta o crea una y pruébalo 14 días.",
  },
  notFound: {
    title: "Esta página no existe.",
    text: "Puede que la dirección esté mal escrita o que la página haya cambiado de lugar.",
    cta: "Ir al inicio",
  },
  legal: {
    toc: "Contenido",
    print: "Imprimir",
    backHome: "Volver al inicio",
  },
  footer: {
    privacy: "Aviso de privacidad",
    terms: "Términos",
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
