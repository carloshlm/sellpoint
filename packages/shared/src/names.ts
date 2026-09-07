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
