import { cn } from "@/lib/utils";

interface BrandWordmarkProps {
  className?: string;
}

/**
 * La marca completa: el logo y «SellPointy» con la letra del sitio
 * (Bricolage Grotesque), como en el menú de sellpointy.com.
 *
 * ── Azul en claro, blanco en oscuro (Carlos, 2026-09-19) ────────────────
 * En claro, el logo de círculo azul y la palabra en el azul de la marca. En
 * oscuro, el logo INVERTIDO —círculo blanco, S azul— y la palabra en blanco:
 * el círculo azul sobre un fondo oscuro no llega ni a 2:1 de contraste.
 *
 * El azul es `brand`, fijo, y NO `primary`: un negocio puede pintar su
 * aplicación de terracota, y la marca de SellPointy no cambia por eso.
 *
 * ── Dos <img> y `dark:` ─────────────────────────────────────────────────
 * Mismo criterio que el logo del menú lateral (`app-layout.tsx`):
 * `applyTheme` enciende `.dark` en <html> según el tema que ELIGIÓ la
 * persona, y un `<picture media="(prefers-color-scheme: dark)">` miraría el
 * del sistema. Los dos logos llevan `alt=""`: la palabra de al lado ya nombra
 * la marca, y un lector de pantalla diría «SellPointy, SellPointy».
 */
function BrandWordmark({ className }: BrandWordmarkProps) {
  return (
    <div className={cn("flex items-center justify-center gap-2.5", className)}>
      <img
        src="/brand/logo.svg"
        alt=""
        width={36}
        height={36}
        className="size-9 shrink-0 dark:hidden"
      />
      <img
        src="/brand/logo-inverted.svg"
        alt=""
        width={36}
        height={36}
        className="hidden size-9 shrink-0 dark:block"
      />
      <span className="font-brand text-[1.75rem] leading-none font-extrabold tracking-[-0.02em] text-brand dark:text-white">
        SellPointy
      </span>
    </div>
  );
}

export { BrandWordmark };
