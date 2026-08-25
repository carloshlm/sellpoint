import { useEffect, useRef } from "react";

/**
 * Trae el elemento a la vista cuando se MONTA (Carlos, 2026-08-25).
 *
 * Los formularios de edición y las confirmaciones de borrado viven en la
 * misma pantalla que la tabla — el form arriba, el diálogo abajo del todo.
 * Quien hace clic en «Editar» en la fila 15 no ve que el formulario apareció
 * fuera del viewport: la pantalla "no hizo nada". El scroll al montar es la
 * respuesta visible al clic.
 *
 * `focusFirstField` además deja el cursor en el primer campo editable: quien
 * editó viene a escribir, no a buscar dónde. En los diálogos NO se enfoca el
 * botón de confirmar — un Enter por inercia ejecutaría la acción destructiva;
 * el foco va al contenedor (tabIndex -1 en quien lo monta).
 *
 * `scrollIntoView?.`: jsdom no lo implementa y los tests no tienen viewport
 * que scrollear — el guard es la diferencia entre un test verde y un crash.
 */
export function useScrollIntoView<T extends HTMLElement>(options?: {
  focusFirstField?: boolean;
  block?: ScrollLogicalPosition;
}) {
  const ref = useRef<T>(null);
  const { focusFirstField = false, block = "center" } = options ?? {};

  // biome-ignore lint/correctness/useExhaustiveDependencies: solo al montar — es la reacción al clic que lo montó
  useEffect(() => {
    const node = ref.current;
    if (!node) {
      return;
    }
    node.scrollIntoView?.({ behavior: "smooth", block });
    if (focusFirstField) {
      const field = node.querySelector<HTMLElement>(
        "input:not([type=hidden]):not(:disabled), select:not(:disabled), textarea:not(:disabled)",
      );
      // preventScroll: el scroll suave de arriba ya está en curso; el focus
      // instantáneo lo pisaría con un salto seco.
      field?.focus({ preventScroll: true });
    } else if (node.tabIndex === -1) {
      node.focus({ preventScroll: true });
    }
  }, []);

  return ref;
}
