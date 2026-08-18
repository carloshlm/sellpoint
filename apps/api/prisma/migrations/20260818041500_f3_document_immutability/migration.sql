-- F3-DOC-02 — lo confirmado es intocable.
--
-- ── Por qué acá NO alcanza el REVOKE ─────────────────────────────────────
--
-- `stock_movements`, `units` y `currencies` se blindan quitándole el
-- privilegio a `sellpoint_app`: la aplicación NO PUEDE hacer UPDATE ni DELETE,
-- y se acabó la discusión. Es la barrera más simple y la más difícil de
-- rodear, porque no depende de que nadie se acuerde de nada.
--
-- Acá esa herramienta no sirve. Un documento de inventario **nace borrador y
-- se edita**: se le cambia el motivo, se le agregan líneas, se corrige una
-- cantidad. Si le quitáramos el UPDATE a la app, no habría forma de cargar un
-- movimiento. La barrera no puede ser QUIÉN escribe sino EN QUÉ ESTADO está la
-- fila — y un privilegio no sabe leer una columna. Un trigger sí.
--
-- Es el PRIMER trigger del proyecto. Se paga esa complejidad porque la
-- promesa que sostiene es la misma que hace auditable al inventario: un
-- documento confirmado es historia, y la historia no se edita — se corrige
-- registrando otro movimiento.
--
-- ── Por qué ERRCODE 42501 ────────────────────────────────────────────────
--
-- Es el mismo `insufficient_privilege` que devuelve un REVOKE. Así la app ve
-- UNA sola clase de error para "esto no se toca", venga de un privilegio
-- (movimientos) o de un estado (documentos), y no necesita dos caminos.
--
-- ── Consecuencia para quien implemente el confirm ────────────────────────
--
-- El trigger mira `OLD.status`, así que la transición `draft → confirmed` pasa
-- (viene de un borrador). Pero **cualquier escritura posterior en la misma
-- transacción ya la ve confirmada**: si el confirm necesita tocar las líneas
-- (por ejemplo guardar el teórico de un conteo), tiene que hacerlo ANTES de
-- marcar el documento. Terminar el contenido y recién entonces sellar.
--
-- RLS sobre estas dos tablas llega en F3-DB-04.

-- ─────────────────────────────────────────────────────────────────────────
-- El documento
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.inventory_document_is_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.status <> 'draft' THEN
    RAISE EXCEPTION
      'El documento % (%) ya no es un borrador: lo confirmado o anulado no se modifica ni se borra.',
      OLD.folio, OLD.status
      USING ERRCODE = '42501';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$$;

COMMENT ON FUNCTION public.inventory_document_is_immutable() IS
  'F3-DOC-02: un documento de inventario solo se modifica mientras es borrador. No se usa REVOKE como en stock_movements porque un borrador SÍ se edita: la barrera es el estado, no el privilegio. Mira OLD.status, así que draft->confirmed pasa y todo lo posterior queda sellado.';

CREATE TRIGGER inventory_documents_immutable
  BEFORE UPDATE OR DELETE ON "inventory_documents"
  FOR EACH ROW
  EXECUTE FUNCTION public.inventory_document_is_immutable();

-- ─────────────────────────────────────────────────────────────────────────
-- Las líneas siguen el estado de su documento
-- ─────────────────────────────────────────────────────────────────────────
--
-- Incluye INSERT, y no por simetría: es el agujero más fácil de dejar
-- abierto. Sin él, el encabezado quedaría intocable pero alguien podría
-- agregarle una línea después de confirmado, y el PDF ya impreso dejaría de
-- coincidir con lo que dice la base.
--
-- El `EXISTS` (en vez de comparar el status directo) resuelve el borrado en
-- cascada: cuando se borra un borrador, Postgres borra sus líneas DESPUÉS de
-- que la fila padre ya no está, así que la búsqueda no encuentra nada y el
-- trigger deja pasar. Si comparáramos contra un SELECT escalar tendríamos que
-- razonar sobre un NULL; así la regla se lee tal cual es: "solo frená si
-- ENCONTRÁS un documento que ya no es borrador".
CREATE OR REPLACE FUNCTION public.inventory_document_line_is_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_document_id uuid := COALESCE(NEW.document_id, OLD.document_id);
  v_folio text;
  v_status text;
BEGIN
  SELECT d.folio, d.status INTO v_folio, v_status
  FROM public.inventory_documents d
  WHERE d.id = v_document_id AND d.status <> 'draft';

  IF FOUND THEN
    RAISE EXCEPTION
      'El documento % (%) ya no es un borrador: sus líneas no se agregan, modifican ni borran.',
      v_folio, v_status
      USING ERRCODE = '42501';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$$;

COMMENT ON FUNCTION public.inventory_document_line_is_immutable() IS
  'F3-DOC-02: las líneas heredan la inmutabilidad de su documento. Cubre INSERT además de UPDATE/DELETE — sin eso se le podrían agregar líneas a un documento ya confirmado e impreso. El EXISTS deja pasar el borrado en cascada de un borrador, donde el padre ya no está.';

CREATE TRIGGER inventory_document_lines_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON "inventory_document_lines"
  FOR EACH ROW
  EXECUTE FUNCTION public.inventory_document_line_is_immutable();
