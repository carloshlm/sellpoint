/**
 * Normaliza un código de lote a MAYÚSCULAS, dígitos y guion (Carlos,
 * 2026-08-23).
 *
 * **Por qué vive en `shared` y no en la pantalla**: `product_lots` tiene
 * `@@unique([productId, lotCode])`, así que `STM01` y `stm01` serían dos lotes
 * DISTINTOS del mismo producto — el FEFO los trataría por separado y el
 * operador vería el mismo lote duplicado, con existencias partidas. Una regla
 * que solo vive en el input la salta cualquier otro camino al API (una
 * importación, otro cliente) y ensucia los datos sin que nadie lo note.
 *
 * La transliteración de acentos NO es adorno: `Ñ` y las vocales acentuadas no
 * son `[A-Z0-9]`, y borrarlas dejaría `"AO"` donde el proveedor escribió
 * `"AÑO"` — un código parecido al bueno es peor que uno rechazado, porque se
 * confunde con él en el listado.
 */
export function normalizeLotCode(raw: string): string {
  return (
    raw
      // NFD separa la letra base de su acento (`é` → `e` + tilde suelta), y el
      // filtro de abajo se lleva la tilde: sobrevive la letra. Sin este paso,
      // `é` es un solo carácter que no es [A-Z0-9] y se perdería entera.
      .normalize("NFD")
      .toUpperCase()
      // El guion SOBREVIVE, y no es un detalle: los lotes de proveedor suelen
      // traerlo (`L-0001`, `LOT-2026-01`). El pedido original era «puras
      // mayúsculas y números», pero dos tests del propio proyecto ya usaban
      // `L-0001` — señal de que el guion es parte del código en este dominio.
      // Se le presentó el costo a Carlos —un lote guardado sin guion deja de
      // coincidir con la caja física en una auditoría— y eligió conservarlo.
      // Lo que se persigue es que `STM01` y `stm01` no sean dos lotes; para
      // eso alcanza con las mayúsculas y con barrer espacios y símbolos.
      .replace(/[^A-Z0-9-]/g, "")
  );
}
