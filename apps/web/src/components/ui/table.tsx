import type * as React from "react";

import { ScrollHint } from "@/components/ui/scroll-hint";
import { SURFACE } from "@/components/ui/surface";
import { useOverflowHint } from "@/lib/ui/use-overflow-hint";
import { cn } from "@/lib/utils";

/**
 * ⚠ El aviso de scroll vive ACÁ y no en cada pantalla.
 *
 * Todas las tablas de la casa pasan por este contenedor, así que ponerlo en
 * un solo lugar le da a Productos, Servicios, Subcatálogos, Almacenes,
 * Usuarios, Roles y a cualquier listado FUTURO el mismo comportamiento en un
 * celular, sin que nadie tenga que acordarse de nada. Antes solo lo tenían
 * los listados que envolvían su tabla a mano en `ScrollableTable` — el resto
 * se cortaba en el borde sin decir que seguía (Carlos, 2026-08-29).
 */
function Table({ className, ...props }: React.ComponentProps<"table">) {
  const { ref, sobra, medir } = useOverflowHint<HTMLDivElement>();

  return (
    <div className="relative">
      {/* La piel de tarjeta viene de `SURFACE` (una sola fuente, tokenizada
          para el selector de temas): los listados no se pintan sobre el fondo
          de la página, van en su propia superficie — el molde de «Mi perfil». */}
      <div
        ref={ref}
        onScroll={medir}
        data-slot="table-container"
        className={cn("relative w-full overflow-x-auto", SURFACE)}
      >
        <table
          data-slot="table"
          className={cn("w-full caption-bottom text-sm", className)}
          {...props}
        />
      </div>
      <ScrollHint visible={sobra} />
    </div>
  );
}

/**
 * El estilo de los listados, en UN lugar (Carlos, 2026-09-02): el encabezado
 * con un fondo apenas distinto y la fila que se resalta bajo el cursor. Las
 * tablas crudas de movimientos y del punto de venta toman estas constantes;
 * así un listado no se ve distinto al de al lado.
 */
export const TABLE_HEAD_ROW = "bg-muted/40 text-left text-muted-foreground";
export const TABLE_ROW_HOVER = "transition-colors hover:bg-muted/50";

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      // El encabezado no es una fila: con fondo propio y sin resaltado.
      className={cn(
        "bg-muted/40 [&_tr]:border-b [&_tr]:border-border [&_tr]:hover:bg-transparent",
        className,
      )}
      {...props}
    />
  );
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  );
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "border-b border-border transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted",
        className,
      )}
      {...props}
    />
  );
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "h-10 px-3 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0",
        className,
      )}
      {...props}
    />
  );
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn("p-3 align-middle [&:has([role=checkbox])]:pr-0", className)}
      {...props}
    />
  );
}

export { Table, TableBody, TableCell, TableHead, TableHeader, TableRow };
