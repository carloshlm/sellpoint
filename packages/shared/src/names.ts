/**
 * F1-NAME-02 — el nombre de una persona, armado en UN solo lugar.
 *
 * Antes vivía repetido: dos `nombreCompleto()` idénticos en el consultorio,
 * dos concatenaciones sueltas en recepción y en el export del catálogo, un
 * `persona()` privado en traspasos, el patrón de dos campos quince veces más
 * en once archivos del API, y otras seis copias en el web. Cada una podía
 * derivar por su cuenta, y algunas ya lo habían hecho: unas llamaban a
 * `.trim()` y otras no.
 *
 * Son DOS funciones y no una a propósito. `fullName` es la identidad completa
 * de alguien —la que se guarda en un expediente o en un snapshot—; `shortName`
 * es cómo se firma un documento o quién atendió una venta, y ahí el segundo
 * apellido sobra. Fusionarlas cambiaría lo que hoy sale impreso en cada
 * ticket.
 *
 * El shape todavía habla de apellido paterno y materno: el rename a
 * `lastName`/`secondLastName` llega en F1-NAME-06 y arrastra a los llamadores
 * desde acá, sin tocarlos uno por uno.
 */
export interface PersonName {
  firstName: string;
  lastNamePaternal: string;
  lastNameMaternal?: string | null;
}

/**
 * Nombre y apellidos, separados por un espacio. Un campo vacío o nulo
 * simplemente no aparece: `filter(Boolean)` y no un template literal, porque
 * el template dejaría un espacio doble donde falta el segundo apellido.
 *
 * **NUNCA trunca.** El límite de 200 de `reception_turns.customer_name` y de
 * `medical_clinic_records.patient_name` es una restricción de esas columnas,
 * no del nombre de la persona: quien guarda aplica su `.slice(0, 200)`. Si
 * viviera acá, un día truncaría también el encabezado de un PDF.
 */
export function fullName(person: PersonName): string {
  return [person.firstName, person.lastNamePaternal, person.lastNameMaternal]
    .filter(Boolean)
    .join(" ");
}

/** Nombre y PRIMER apellido: quien vendió, quien autorizó, quien firma. */
export function shortName(person: Pick<PersonName, "firstName" | "lastNamePaternal">): string {
  return [person.firstName, person.lastNamePaternal].filter(Boolean).join(" ");
}

/**
 * ── Cuántos apellidos pide un país ──────────────────────────────────────
 *
 * `single` NO significa «una palabra», significa «un campo». Un argentino con
 * dos apellidos y un brasileño con cuatro se escriben ahí adentro sin perder
 * nada: la búsqueda de clientes es por `contains`, así que «Pérez» se sigue
 * encontrando dentro de «Pérez García».
 *
 * `compound` dibuja el mismo campo único que `single` — lo que cambia es la
 * ETIQUETA, en plural («Apellidos»), porque en Portugal y Brasil el orden es
 * materno→paterno y caben hasta cuatro. Existe como formato propio para que
 * nadie lea «un apellido» y asuma «una palabra».
 */
export const NAME_FORMATS = ["single", "double", "compound"] as const;
export type NameFormat = (typeof NAME_FORMATS)[number];

/**
 * Dos casillas, como en el registro civil de estos países. Los 16 curados más
 * los cinco que comparten la costumbre sin estar en el catálogo (Cuba,
 * República Dominicana, Puerto Rico, Guinea Ecuatorial y Andorra).
 *
 * **Argentina NO está acá.** El Código Civil y Comercial (art. 64, 2015) da un
 * apellido por defecto —el primero de alguno de los cónyuges— y el del otro
 * «se puede agregar» a pedido; el DNI lo guarda todo en un campo único. Pedirle
 * a un argentino un «apellido materno» es tan raro como pedírselo a un
 * canadiense.
 */
export const DOUBLE_SURNAME_COUNTRIES = [
  "MX",
  "ES",
  "CR",
  "SV",
  "GT",
  "HN",
  "NI",
  "PA",
  "BO",
  "CL",
  "CO",
  "EC",
  "PY",
  "PE",
  "UY",
  "VE",
  "CU",
  "DO",
  "PR",
  "GQ",
  "AD",
] as const;

/** Un campo, etiqueta en plural: el mundo lusófono. */
export const COMPOUND_SURNAME_COUNTRIES = ["PT", "BR", "AO", "MZ", "CV", "GW", "ST", "TL"] as const;

/**
 * El país sale de `tenants.country` — del NEGOCIO, no de la persona. Sin país,
 * país desconocido o código en minúscula caen a `single`: es el formato que no
 * le pide de más a nadie. No se normaliza la caja a propósito, mismo criterio
 * que `resolveTaxDefaults`.
 */
export function resolveNameFormat(country: string | null | undefined): NameFormat {
  if (country === null || country === undefined) return "single";
  if ((DOUBLE_SURNAME_COUNTRIES as readonly string[]).includes(country)) return "double";
  if ((COMPOUND_SURNAME_COUNTRIES as readonly string[]).includes(country)) return "compound";
  return "single";
}

/**
 * Lo único que el formulario necesita preguntar: ¿dibujo una casilla aparte
 * para el segundo apellido? Solo `double`. Y recuerda que esto decide qué se
 * PIDE, nunca qué se ACEPTA: el servidor guarda un segundo apellido venga de
 * donde venga.
 */
export function asksSecondSurname(format: NameFormat): boolean {
  return format === "double";
}
