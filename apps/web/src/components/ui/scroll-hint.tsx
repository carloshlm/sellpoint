import { useTranslation } from "react-i18next";

/**
 * El aviso de que una tabla sigue hacia la derecha: un degradado en el borde
 * y una leyenda debajo.
 *
 * ── Por qué existe ──────────────────────────────────────────────────────
 *
 * `overflow-x-auto` por sí solo no alcanza: en un celular la barra de scroll
 * es invisible, así que la tabla se corta en el borde y parece que ahí
 * termina. Nadie descubre lo que no sabe que existe — de nada sirve que se
 * pueda deslizar si nada lo dice.
 *
 * Aparece SOLO si sobra contenido y desaparece al llegar al final: una
 * leyenda permanente se vuelve parte del decorado y deja de leerse.
 */
export function ScrollHint({ visible }: { visible: boolean }) {
  const { t } = useTranslation();

  if (!visible) {
    return null;
  }

  return (
    <>
      {/* `from-card` y no `from-background`: el degradado vive DENTRO de la
          tarjeta, así que tiene que fundirse con ella. Con el fondo de la
          página se veía una franja gris flotando sobre el blanco. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 right-0 w-8 rounded-r-lg bg-gradient-to-l from-card to-transparent"
      />
      <p data-testid="scroll-hint" className="mt-1 text-muted-foreground text-xs">
        {t("common.table.scrollHint")}
      </p>
    </>
  );
}
