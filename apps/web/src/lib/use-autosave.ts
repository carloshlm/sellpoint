import { useEffect, useRef } from "react";

const AUTOGUARDADO_MS = 400;

/**
 * Autoguardado ACUMULADO de una cabecera: el cambio viaja `ms` después de la
 * última tecla, y los cambios de varios campos viajan JUNTOS.
 *
 * Nació en `purchase-detail.tsx` (F9-PURCH-11) por un bug que cazó el
 * navegador el 2026-09-10: con un temporizador por cabecera y un `input`
 * suelto por llamada, teclear el total declarado y saltar a la factura
 * mandaba solo la factura, y el total se perdía sin decir nada. El
 * acumulador hace que la pausa mande los dos en UN `PATCH`. F9-PO-12 lo
 * extrae para que la orden de compra no repita el bug.
 *
 * `enviar` recibe la unión de todo lo tecleado desde la última pausa; quien
 * llama decide a qué endpoint va (borrador vs. confirmada, por ejemplo).
 */
export function useAutosave<T extends object>(
  enviar: (cambios: T) => void,
  ms = AUTOGUARDADO_MS,
): (cambio: T) => void {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendiente = useRef<T>({} as T);
  const ultimoEnviar = useRef(enviar);
  ultimoEnviar.current = enviar;

  useEffect(() => () => (timer.current !== null ? clearTimeout(timer.current) : undefined), []);

  return (cambio: T) => {
    pendiente.current = { ...pendiente.current, ...cambio };
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const cambios = pendiente.current;
      pendiente.current = {} as T;
      ultimoEnviar.current(cambios);
    }, ms);
  };
}
