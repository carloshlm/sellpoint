#!/usr/bin/env python3
"""
Genera las migraciones del catálogo GLOBAL de códigos de barras a partir de
los volcados de Open Food Facts.

Fuente: https://world.openfoodfacts.org/data (volcado nocturno, ODbL).
Licencia ODbL: uso comercial permitido, atribución obligatoria y share-alike
sobre la base DERIVADA. Por eso `source` distingue las filas de Open Food
Facts de las que aportan los negocios: las segundas son nuestras y no heredan
ninguna obligación.

Uso:
  # 1. La estructura (una sola vez): tablas + rangos de prefijos GS1
  python3 build-migration.py estructura <carpeta de la migración>

  # 2. Los datos, una migración POR REGIÓN, cuando se quieran
  python3 build-migration.py datos --region latam        <carpeta>
  python3 build-migration.py datos --region norteamerica <carpeta>
  python3 build-migration.py datos --region MX           <carpeta>

  # Varias regiones sin volver a descargar 1.2 GB cada vez
  curl -L -o volcado.csv.gz \\
    https://static.openfoodfacts.org/data/en.openfoodfacts.org.products.csv.gz
  python3 build-migration.py datos --region canada --volcado volcado.csv.gz <carpeta>

`--region` acepta un grupo de gs1-prefixes.py (latam, norteamerica, usa,
canada, iberia) o un país ISO suelto. Añadir Canadá y Estados Unidos más
adelante NO toca el esquema: es correr el comando otra vez con otra región.

Solo biblioteca estándar. Descarga en streaming: nunca escribe los 9 GB del
volcado a disco.

Como el de CIE-10, es un generador de UN SOLO USO por región y por versión
del volcado: el SQL que sale es la fuente de verdad y viaja en
`prisma/migrations`. Este script existe para poder repetirlo cuando Open Food
Facts publique datos nuevos o cuando se sume una región.
"""
from __future__ import annotations

import argparse
import csv
import gzip
import importlib.util
import sys
import unicodedata
import urllib.request
from pathlib import Path

URL = "https://static.openfoodfacts.org/data/en.openfoodfacts.org.products.csv.gz"
LOTE = 500
TABLA = "global_barcode_catalog"
TABLA_PREFIJOS = "gs1_prefix_ranges"

AQUI = Path(__file__).parent


def cargar(nombre: str, archivo: str):
    """Importa un módulo hermano por ruta: los nombres con guion no se importan."""
    spec = importlib.util.spec_from_file_location(nombre, AQUI / archivo)
    modulo = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modulo)
    return modulo


gtin = cargar("gtin", "gtin.py")
prefijos = cargar("gs1_prefixes", "gs1-prefixes.py")


def sql(valor: str) -> str:
    """Literal de texto para Postgres, con las comillas simples escapadas."""
    return "'" + valor.replace("'", "''") + "'"


def sin_acentos(texto: str) -> str:
    return "".join(
        c for c in unicodedata.normalize("NFD", texto) if unicodedata.category(c) != "Mn"
    )


def recortar(texto: str, largo: int) -> str:
    return texto.strip()[:largo].strip()


def paises_de(region: str) -> set[str]:
    """Resuelve `--region` a un conjunto de países ISO."""
    clave = region.lower()
    if clave in prefijos.REGIONES:
        return set(prefijos.REGIONES[clave])
    if len(region) == 2 and region.isalpha():
        return {region.upper()}
    sys.exit(
        f"Región desconocida: {region!r}. "
        f"Grupos: {', '.join(sorted(prefijos.REGIONES))}, o un país ISO de dos letras."
    )


def abrir_volcado(volcado: Path | None):
    """Devuelve el volcado listo para leer, de un archivo local o de la red.

    Con `--volcado` se genera región tras región sin volver a bajar 1.2 GB
    cada vez: se descarga una sola vez y se reusa para LATAM, Canadá y
    Estados Unidos.
    """
    if volcado is not None:
        return gzip.open(volcado, "rt", encoding="utf-8", errors="replace")
    peticion = urllib.request.Request(URL, headers={"User-Agent": "SellPoint/1.0"})
    return gzip.open(urllib.request.urlopen(peticion), "rt",
                     encoding="utf-8", errors="replace")


def leer_productos(quiero: set[str], volcado: Path | None = None,
                   criterio: str = "prefijo") -> tuple[list[tuple], dict[str, int]]:
    """Recorre el volcado y devuelve las filas de los países pedidos.

    El volcado es un CSV con TABs cuyos campos de ingredientes traen saltos de
    línea dentro de las comillas: hay que leerlo con un parser de CSV de
    verdad. Procesarlo por líneas (awk, grep) parte registros a la mitad.
    """
    csv.field_size_limit(10**9)
    registros: dict[str, tuple] = {}
    conteo = {"leidos": 0, "sin_nombre": 0, "gtin_invalido": 0,
              "no_importable": 0, "otra_region": 0, "duplicados": 0}
    # Con criterio «venta» se busca el nombre del país en `countries_en`.
    mercados = {prefijos.NOMBRES_EN[p]: p for p in quiero if p in prefijos.NOMBRES_EN}
    if criterio == "venta" and not mercados:
        sys.exit("Ningún país de la región tiene nombre en NOMBRES_EN (gs1-prefixes.py).")

    with abrir_volcado(volcado) as entrada:
        for fila in csv.DictReader(entrada, delimiter="\t"):
            conteo["leidos"] += 1

            nombre = recortar(fila.get("product_name") or "", 300)
            if not nombre:
                conteo["sin_nombre"] += 1
                continue

            clasificado = gtin.clasificar(fila.get("code") or "", prefijos)
            if clasificado is None:
                conteo["gtin_invalido"] += 1
                continue
            gtin14, pais, importable = clasificado

            if not importable:
                conteo["no_importable"] += 1
                continue

            if criterio == "venta":
                # `countries_en` viene separado por comas: «Canada, France».
                vendidos = {c.strip() for c in (fila.get("countries_en") or "").split(",")}
                mercado = next((mercados[n] for n in vendidos if n in mercados), None)
                if mercado is None:
                    conteo["otra_region"] += 1
                    continue
            else:
                mercado = None
                if pais not in quiero:
                    conteo["otra_region"] += 1
                    continue

            if gtin14 in registros:
                conteo["duplicados"] += 1
                continue

            registros[gtin14] = (
                gtin14,
                nombre,
                recortar(fila.get("brands") or "", 120),
                recortar(fila.get("quantity") or "", 60),
                pais,
                mercado,
                recortar(sin_acentos(nombre).lower(), 300),
            )
            if len(registros) % 5000 == 0:
                print(f"  {len(registros)} productos…", file=sys.stderr)

    return [registros[k] for k in sorted(registros)], conteo


def escribir_estructura(carpeta: Path) -> None:
    carpeta.mkdir(parents=True, exist_ok=True)
    salida = carpeta / "migration.sql"
    rangos = prefijos.RANGOS

    with salida.open("w", encoding="utf-8") as out:
        out.write(f"""-- Catálogo GLOBAL de códigos de barras: la estructura.
--
-- Sin tenant_id y sin RLS a propósito, como `permissions` y el catálogo
-- CIE-10: un código de barras significa lo mismo en todos los negocios. Lo
-- que SÍ es de cada tenant es su precio y su existencia, y eso ya vive en
-- `product_presentations`.
--
-- Para qué: al dar de alta un producto, el cajero escanea y el sistema le
-- SUGIERE el nombre en vez de hacerlo teclearlo. Sugiere, no autocompleta en
-- silencio — el tenant confirma, y esa confirmación es la que sube
-- `confirmations`. Un nombre que 40 negocios confirmaron vale más que
-- cualquier base de pago.
--
-- La clave es el GTIN-14, no el código tal como se escaneó. El MISMO producto
-- se lee de distinta forma según el simbolismo: una lata estadounidense trae
-- UPC-A de 12 dígitos y esa misma lata, en un catálogo europeo, viaja como
-- EAN-13 con un cero al frente. Rellenando a 14 las cuatro longitudes de GTIN
-- colapsan en una sola clave, y encontrar el producto deja de depender de con
-- qué lector se escaneó. La normalización y el dígito verificador viven en
-- prisma/seed/barcode-catalog/gtin.py.
--
-- Los DATOS viajan en migraciones aparte, una por región, generadas por
-- prisma/seed/barcode-catalog/build-migration.py. Sumar Estados Unidos o
-- Canadá después no toca este esquema.
--
-- Deshacer, si hiciera falta:
--   DROP TABLE "{TABLA}";
--   DROP TABLE "{TABLA_PREFIJOS}";
CREATE TABLE "{TABLA}" (
  "gtin14"        CHAR(14)     NOT NULL,
  "product_name"  VARCHAR(300) NOT NULL,
  "brand"         VARCHAR(120),
  "unit_size"     VARCHAR(60),
  -- País que EMITIÓ el prefijo GS1, no donde se fabricó: una empresa mexicana
  -- puede licenciar su prefijo en cualquier organización GS1. Sirve para
  -- importar y depurar por región, nunca para decirle «hecho en» a nadie.
  "country_code"  CHAR(2),
  -- El MERCADO por el que entró esta fila: en qué país se vende, según el
  -- volcado. NULL cuando la fila entró por prefijo GS1 y no por mercado.
  --
  -- Son dos hechos distintos y hay que guardarlos aparte. En Canadá el
  -- prefijo no dice nada: 177 productos del volcado llevan prefijo canadiense
  -- (754-755) contra 126,467 que se venden ahí, porque las empresas
  -- canadienses registran sus códigos con GS1 Estados Unidos. Una lata con
  -- `country_code = 'US'` y `market_code = 'CA'` no es una contradicción:
  -- se registró en Estados Unidos y se vende en Canadá.
  "market_code"   CHAR(2),
  -- Nombre sin acentos y en minúsculas: se busca «jabon» y aparece «jabón».
  "search"        VARCHAR(300) NOT NULL,
  -- 'open_food_facts' arrastra la obligación ODbL (atribución y share-alike
  -- sobre la base derivada); 'tenant_contributed' es nuestro y no la hereda.
  -- Separarlos es lo que permite exportar o licenciar lo propio algún día.
  "source"        VARCHAR(24)  NOT NULL,
  -- Cuántos tenants DISTINTOS confirmaron este nombre. Es la señal de
  -- calidad: a mayor número, más arriba se sugiere.
  "confirmations" INTEGER      NOT NULL DEFAULT 0,
  "created_at"    TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- Sin DEFAULT, como el resto del esquema: lo pone Prisma con @updatedAt, y
  -- las migraciones de datos lo escriben explícitamente con now().
  "updated_at"    TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "{TABLA}_pkey" PRIMARY KEY ("gtin14"),
  CONSTRAINT "{TABLA}_gtin14_check" CHECK ("gtin14" ~ '^[0-9]{{14}}$'),
  CONSTRAINT "{TABLA}_source_check"
    CHECK ("source" IN ('open_food_facts', 'tenant_contributed')),
  CONSTRAINT "{TABLA}_confirmations_check" CHECK ("confirmations" >= 0)
);

-- La búsqueda por nombre del alta de producto, cuando el código no aparece.
CREATE INDEX "{TABLA}_search_idx" ON "{TABLA}" ("search" varchar_pattern_ops);
-- Depurar o reimportar una región completa sin recorrer la tabla entera.
CREATE INDEX "{TABLA}_country_idx" ON "{TABLA}" ("country_code");
-- «Dame lo que se vende en Canadá»: la consulta natural con varios mercados.
CREATE INDEX "{TABLA}_market_idx" ON "{TABLA}" ("market_code");

-- Rangos de prefijos GS1 → país emisor. Va en la base, y no en una constante
-- de TypeScript, porque el API la necesita en caliente: cuando un negocio
-- aporta un código que nadie conocía, hay que sellarle su `country_code` sin
-- volver a desplegar. `is_importable` en false marca lo que NUNCA debe entrar
-- al catálogo compartido: los rangos de circulación restringida (etiquetas de
-- báscula, códigos que la propia tienda imprime), que significan cosas
-- distintas en cada negocio, más cupones, ISBN y recibos de reembolso.
CREATE TABLE "{TABLA_PREFIJOS}" (
  "prefix_from"   CHAR(3)  NOT NULL,
  "prefix_to"     CHAR(3)  NOT NULL,
  "country_code"  CHAR(2),
  "is_importable" BOOLEAN  NOT NULL,
  CONSTRAINT "{TABLA_PREFIJOS}_pkey" PRIMARY KEY ("prefix_from"),
  CONSTRAINT "{TABLA_PREFIJOS}_orden_check" CHECK ("prefix_to" >= "prefix_from"),
  CONSTRAINT "{TABLA_PREFIJOS}_pais_check"
    CHECK (("is_importable" AND "country_code" IS NOT NULL)
        OR (NOT "is_importable" AND "country_code" IS NULL))
);

INSERT INTO "{TABLA_PREFIJOS}" ("prefix_from", "prefix_to", "country_code", "is_importable") VALUES
""")
        lineas = [
            "  (" + ", ".join([
                sql(desde), sql(hasta),
                sql(pais) if pais else "NULL",
                "true" if importable else "false",
            ]) + ")"
            for desde, hasta, pais, importable in rangos
        ]
        out.write(",\n".join(lineas) + '\nON CONFLICT ("prefix_from") DO NOTHING;\n')

    print(f"{salida}: estructura + {len(rangos)} rangos de prefijos GS1")


def escribir_csv(destino: Path, registros: list[tuple], conteo: dict[str, int],
                 region: str, criterio: str) -> None:
    """Escribe el catálogo como CSV para `COPY`, que es como se carga en serio.

    Por qué CSV y no INSERT: el mismo millón de filas pesa ~99 MB en INSERT y
    ~60 MB en CSV, y `COPY` lo mete en segundos donde los INSERT por lotes
    tardan medio minuto. En producción, además, no queremos un archivo de
    99 MB viajando por SSH.

    Formato CSV y no TSV a propósito: los nombres de producto traen tabuladores
    y comillas, y el módulo `csv` los escapa bien. `COPY ... WITH (FORMAT csv)`
    los lee igual de bien. Con TSV habría que limpiar a mano y se escapa uno.
    """
    destino.parent.mkdir(parents=True, exist_ok=True)
    with destino.open("w", newline="", encoding="utf-8") as salida:
        # lineterminator="\n" y no el "\r\n" por omisión de csv.writer:
        # `COPY ... FORMAT csv` deduce el fin de línea de la PRIMERA línea y
        # después lo exige. Con \r\n en los datos y \n en el terminador `\.`
        # de psql, la carga muere con «unquoted newline found in data» en la
        # última línea — y el mensaje apunta al sitio equivocado.
        escritor = csv.writer(salida, lineterminator="\n")
        for gtin14, nombre, marca, medida, pais, mercado, busqueda in registros:
            escritor.writerow([gtin14, nombre, marca or "", medida or "",
                               pais or "", mercado or "", busqueda,
                               "open_food_facts"])
    por_pais: dict[str, int] = {}
    indice = 5 if criterio == "venta" else 4
    for r in registros:
        por_pais[r[indice] or "??"] = por_pais.get(r[indice] or "??", 0) + 1
    resumen = ", ".join(f"{p} {n}" for p, n in sorted(por_pais.items(), key=lambda x: -x[1]))
    print(f"{destino}: {len(registros)} productos ({resumen})")


def escribir_datos(carpeta: Path, region: str, volcado: Path | None = None,
                   criterio: str = "prefijo") -> None:
    quiero = paises_de(region)
    print(f"Región {region} → {len(quiero)} países: {', '.join(sorted(quiero))}",
          file=sys.stderr)
    registros, conteo = leer_productos(quiero, volcado, criterio)
    if not registros:
        sys.exit(f"Ningún producto para la región {region!r}. Nada que escribir.")

    indice = 5 if criterio == "venta" else 4
    por_pais: dict[str, int] = {}
    for r in registros:
        por_pais[r[indice] or "??"] = por_pais.get(r[indice] or "??", 0) + 1
    resumen = ", ".join(f"{p} {n}" for p, n in sorted(por_pais.items(), key=lambda x: -x[1]))

    carpeta.mkdir(parents=True, exist_ok=True)
    salida = carpeta / "migration.sql"
    with salida.open("w", encoding="utf-8") as out:
        out.write(f"""-- Catálogo global de códigos de barras: los datos de la región «{region}».
--
-- Criterio de selección: {"mercado donde se VENDE (columna countries_en)" if criterio == "venta" else "prefijo GS1 del código"}.
--
-- Fuente: volcado de Open Food Facts (ODbL), generado por
-- prisma/seed/barcode-catalog/build-migration.py.
-- {len(registros)} productos: {resumen}.
--
-- De {conteo["leidos"]} filas del volcado se descartaron: {conteo["sin_nombre"]} sin nombre
-- (un código sin nombre no le sugiere nada al cajero), {conteo["gtin_invalido"]} con GTIN
-- inválido (longitud o dígito verificador), {conteo["no_importable"]} de rangos de
-- circulación restringida, cupones o ISBN, {conteo["otra_region"]} de otras regiones y
-- {conteo["duplicados"]} duplicados tras normalizar a GTIN-14.
--
-- ON CONFLICT DO NOTHING: si una fila ya está, gana la que estaba. Un dato
-- que un negocio confirmó a mano NUNCA se pisa con uno de Open Food Facts.
--
-- Deshacer, si hiciera falta:
--   DELETE FROM "{TABLA}"
--    WHERE "source" = 'open_food_facts'
--      AND "{"market_code" if criterio == "venta" else "country_code"}" IN ({", ".join(sql(p) for p in sorted(por_pais))});

""")
        for i in range(0, len(registros), LOTE):
            out.write(
                f'INSERT INTO "{TABLA}" ("gtin14", "product_name", "brand", '
                '"unit_size", "country_code", "market_code", "search", "source", '
                '"updated_at") VALUES\n'
            )
            lineas = []
            for gtin14, nombre, marca, medida, pais, mercado, busqueda in registros[i:i + LOTE]:
                lineas.append(
                    "  (" + ", ".join([
                        sql(gtin14),
                        sql(nombre),
                        sql(marca) if marca else "NULL",
                        sql(medida) if medida else "NULL",
                        sql(pais) if pais else "NULL",
                        sql(mercado) if mercado else "NULL",
                        sql(busqueda),
                        "'open_food_facts'",
                        "now()",
                    ]) + ")"
                )
            out.write(",\n".join(lineas) + '\nON CONFLICT ("gtin14") DO NOTHING;\n\n')

    print(f"{salida}: {len(registros)} productos ({resumen})")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="comando", required=True)

    p_est = sub.add_parser("estructura", help="tablas + rangos de prefijos GS1")
    p_est.add_argument("carpeta", type=Path)

    p_dat = sub.add_parser("datos", help="los productos de una región")
    p_dat.add_argument("carpeta", type=Path)
    p_dat.add_argument("--region", required=True)
    p_dat.add_argument(
        "--volcado", type=Path, default=None,
        help="volcado .csv.gz ya descargado; sin esto se baja de Open Food Facts")
    p_dat.add_argument(
        "--criterio", choices=("prefijo", "venta"), default="prefijo",
        help="prefijo: por quién emitió el código GS1 (sirve en México). "
             "venta: por dónde se vende, según countries_en (obligatorio en "
             "Canadá, donde el prefijo no dice nada).")

    p_csv = sub.add_parser("csv", help="los productos de una región, como CSV para COPY")
    p_csv.add_argument("destino", type=Path, help="archivo .csv de salida")
    p_csv.add_argument("--region", required=True)
    p_csv.add_argument("--volcado", type=Path, default=None)
    p_csv.add_argument("--criterio", choices=("prefijo", "venta"), default="prefijo")

    args = parser.parse_args()
    if args.comando == "estructura":
        escribir_estructura(args.carpeta)
    elif args.comando == "csv":
        quiero = paises_de(args.region)
        registros, conteo = leer_productos(quiero, args.volcado, args.criterio)
        if not registros:
            sys.exit(f"Ningún producto para la región {args.region!r}.")
        escribir_csv(args.destino, registros, conteo, args.region, args.criterio)
    else:
        escribir_datos(args.carpeta, args.region, args.volcado, args.criterio)


if __name__ == "__main__":
    main()
