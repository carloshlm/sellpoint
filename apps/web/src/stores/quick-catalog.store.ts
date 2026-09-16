import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/** En qué estado está una línea del borrador. */
export type QuickLineStatus =
  /** La consulta está en vuelo. La fila ya se ve: un escaneo no puede desaparecer. */
  | "searching"
  /** El catálogo compartido lo conoce: nombre sugerido, editable. */
  | "known"
  /** El negocio YA lo tiene: el nombre es suyo y no se toca, solo el precio. */
  | "owned"
  /** No lo conoce nadie: el nombre lo escribe la persona. */
  | "new"
  /** La consulta falló. La fila queda con su motivo y se puede reintentar. */
  | "failed";

export interface QuickLine {
  /** El código tal como se escaneó. Es la identidad de la fila. */
  code: string;
  status: QuickLineStatus;
  name: string;
  /** Texto crudo del campo de precio, como lo guarda cualquier formulario. */
  price: string;
  /** Qué marca sugirió el catálogo compartido, si sugirió alguna. */
  brand: string | null;
  /** Si al guardarse este código se le va a regalar al catálogo de todos. */
  contributable: boolean;
}

/**
 * El tope de líneas. **Es el mismo del API** (`QUICK_ADD_MAX_LINES`): que la
 * pantalla permita más de lo que el servidor acepta sería una pared al final
 * del trabajo, después de escanear.
 */
export const QUICK_MAX_LINES = 100;

/** La versión de la FORMA del borrador. Ver `migrate`. */
const VERSION = 1;

interface QuickCatalogState {
  /**
   * De quién es este borrador: `tenantId:userId`.
   *
   * Va DENTRO del valor y no en el nombre de la clave a propósito: una clave
   * por usuario dejaría borradores huérfanos que nadie recoge nunca. Con el
   * sello adentro, entrar con otra cuenta lo descarta y punto.
   */
  owner: string | null;
  lines: QuickLine[];
  /** Si el navegador rechazó guardar (cuota llena, modo privado). */
  storageFailed: boolean;

  /** Descarta el borrador si es de otra identidad. Se llama al montar. */
  claim: (owner: string) => void;
  /** Agrega la fila optimista. Devuelve `false` si el código ya estaba o no cabe. */
  add: (code: string) => boolean;
  patch: (code: string, cambios: Partial<Omit<QuickLine, "code">>) => void;
  remove: (code: string) => void;
  clear: () => void;
}

const almacen = createJSONStorage<QuickCatalogState>(() => localStorage);

/**
 * F10-QUICKCAT-06 — el borrador de la carga rápida, en el navegador.
 *
 * ── Por qué persiste, y por qué NO en el servidor ───────────────────────
 *
 * Escanear 80 productos toma media hora, y cualquier cosa —tocar el menú sin
 * querer, una recarga, la batería— borraría esa media hora. Eso lo resuelve
 * `persist`. Guardarlo en el servidor resolvería además que el borrador viaje
 * entre equipos, pero cuesta una tabla, un endpoint y su limpieza, para un
 * caso —empezar en la tablet y terminar en la caja— que nadie pidió. Decisión
 * de Carlos (2026-09-16): en el navegador.
 *
 * ── Lo que nunca se guarda ──────────────────────────────────────────────
 *
 * Sesión: ni token, ni permisos, ni nombre de usuario. Solo el sello de dueño,
 * que es el par de ids que ya viven en la sesión y no abre nada.
 *
 * ── Un cambio de forma DESCARTA ─────────────────────────────────────────
 *
 * `migrate` devuelve el estado vacío ante cualquier versión anterior. Volver a
 * escanear cuesta minutos; arrastrar migraciones de un borrador cuesta para
 * siempre.
 *
 * ── Si el navegador no deja guardar ─────────────────────────────────────
 *
 * En modo privado o con la cuota llena, escribir revienta. La captura sigue
 * viva en memoria y la pantalla avisa que esta vez no sobrevive a una recarga:
 * perder el aviso sería peor que perder la persistencia.
 */
export const useQuickCatalogStore = create<QuickCatalogState>()(
  persist(
    (set, get) => ({
      owner: null,
      lines: [],
      storageFailed: false,

      claim: (owner) =>
        set((estado) =>
          estado.owner === owner ? estado : { owner, lines: [], storageFailed: false },
        ),

      add: (code) => {
        const { lines } = get();
        if (lines.length >= QUICK_MAX_LINES || lines.some((linea) => linea.code === code)) {
          return false;
        }
        // Arriba y no abajo: la fila nueva aparece pegada al campo de escaneo,
        // donde está la vista. Consecuencia asumida: los errores del API se
        // ubican por CÓDIGO, nunca por índice.
        set({
          lines: [
            { code, status: "searching", name: "", price: "", brand: null, contributable: false },
            ...lines,
          ],
        });
        return true;
      },

      patch: (code, cambios) =>
        set((estado) => ({
          lines: estado.lines.map((linea) =>
            linea.code === code ? { ...linea, ...cambios } : linea,
          ),
        })),

      remove: (code) =>
        set((estado) => ({ lines: estado.lines.filter((linea) => linea.code !== code) })),

      clear: () => set({ lines: [] }),
    }),
    {
      name: "sellpoint.quickCatalog",
      version: VERSION,
      storage: {
        getItem: (name) => {
          try {
            return almacen?.getItem(name) ?? null;
          } catch {
            // Modo privado o almacenamiento bloqueado: se arranca en blanco.
            return null;
          }
        },
        setItem: (name, value) => {
          try {
            almacen?.setItem(name, value);
          } catch {
            useQuickCatalogStore.setState({ storageFailed: true });
          }
        },
        removeItem: (name) => {
          try {
            almacen?.removeItem(name);
          } catch {
            // No poder borrar no rompe nada: el sello de dueño ya lo descarta.
          }
        },
      },
      // Solo los datos: las acciones se recrean en cada arranque y `storageFailed`
      // describe ESTA sesión, no algo que valga la pena recordar.
      partialize: (estado) =>
        ({ owner: estado.owner, lines: estado.lines }) as unknown as QuickCatalogState,
      migrate: () =>
        ({ owner: null, lines: [], storageFailed: false }) as unknown as QuickCatalogState,
    },
  ),
);
