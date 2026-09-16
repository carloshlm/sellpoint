#!/usr/bin/env python3
"""Rangos de prefijos GS1 → país emisor.

Fuente: lista oficial de prefijos GS1 (GS1 General Specifications).
Un prefijo dice dónde se REGISTRÓ el GTIN, NO dónde se fabricó el producto:
una empresa mexicana puede licenciar un prefijo en cualquier organización
GS1. Para un catálogo de nombres de producto eso da igual — lo usamos para
poder importar por región y para saber qué NO importar.

Cada rango es (desde, hasta, país ISO-3166 o None, importable).
`importable = False` marca los rangos que JAMÁS deben entrar al catálogo
global, explicados abajo.
"""
# Para que `str | None` funcione también en Python 3.9.
from __future__ import annotations

# Rangos de circulación restringida y códigos que no identifican un producto.
# Un POS los va a escanear todo el tiempo (etiquetas de báscula, códigos que
# la propia tienda imprime) y significan cosas DISTINTAS en cada negocio: el
# 2000000000017 de una carnicería no es el de la tienda de al lado. Meterlos
# a un catálogo compartido sería envenenarlo.
RANGOS = [
    ("000", "019", "US", True),   # Estados Unidos (UPC-A)
    ("020", "029", None, False),  # Circulación restringida — región geográfica
    ("030", "039", "US", True),   # Estados Unidos (medicamentos NDC)
    ("040", "049", None, False),  # Circulación restringida — dentro de una empresa
    ("050", "059", None, False),  # Cupones
    ("060", "139", "US", True),   # Estados Unidos
    ("200", "299", None, False),  # Circulación restringida — región geográfica
    ("300", "379", "FR", True),   # Francia y Mónaco
    ("380", "380", "BG", True),
    ("383", "383", "SI", True),
    ("385", "385", "HR", True),
    ("387", "387", "BA", True),
    ("389", "389", "ME", True),
    ("390", "390", "XK", True),
    ("400", "440", "DE", True),
    ("450", "459", "JP", True),
    ("460", "469", "RU", True),
    ("470", "470", "KG", True),
    ("471", "471", "TW", True),
    ("474", "474", "EE", True),
    ("475", "475", "LV", True),
    ("476", "476", "AZ", True),
    ("477", "477", "LT", True),
    ("478", "478", "UZ", True),
    ("479", "479", "LK", True),
    ("480", "480", "PH", True),
    ("481", "481", "BY", True),
    ("482", "482", "UA", True),
    ("483", "483", "TM", True),
    ("484", "484", "MD", True),
    ("485", "485", "AM", True),
    ("486", "486", "GE", True),
    ("487", "487", "KZ", True),
    ("488", "488", "TJ", True),
    ("489", "489", "HK", True),
    ("490", "499", "JP", True),
    ("500", "509", "GB", True),
    ("520", "521", "GR", True),
    ("528", "528", "LB", True),
    ("529", "529", "CY", True),
    ("530", "530", "AL", True),
    ("531", "531", "MK", True),
    ("535", "535", "MT", True),
    ("539", "539", "IE", True),
    ("540", "549", "BE", True),  # Bélgica y Luxemburgo
    ("560", "560", "PT", True),
    ("569", "569", "IS", True),
    ("570", "579", "DK", True),
    ("590", "590", "PL", True),
    ("594", "594", "RO", True),
    ("599", "599", "HU", True),
    ("600", "601", "ZA", True),
    ("603", "603", "GH", True),
    ("604", "604", "SN", True),
    ("608", "608", "BH", True),
    ("609", "609", "MU", True),
    ("611", "611", "MA", True),
    ("613", "613", "DZ", True),
    ("615", "615", "NG", True),
    ("616", "616", "KE", True),
    ("618", "618", "CI", True),
    ("619", "619", "TN", True),
    ("620", "620", "TZ", True),
    ("621", "621", "SY", True),
    ("622", "622", "EG", True),
    ("624", "624", "LY", True),
    ("625", "625", "JO", True),
    ("626", "626", "IR", True),
    ("627", "627", "KW", True),
    ("628", "628", "SA", True),
    ("629", "629", "AE", True),
    ("630", "630", "QA", True),
    ("631", "631", "NA", True),
    ("640", "649", "FI", True),
    ("690", "699", "CN", True),
    ("700", "709", "NO", True),
    ("729", "729", "IL", True),
    ("730", "739", "SE", True),
    ("740", "740", "GT", True),
    ("741", "741", "SV", True),
    ("742", "742", "HN", True),
    ("743", "743", "NI", True),
    ("744", "744", "CR", True),
    ("745", "745", "PA", True),
    ("746", "746", "DO", True),
    ("750", "750", "MX", True),   # México
    ("754", "755", "CA", True),   # Canadá
    ("759", "759", "VE", True),
    ("760", "769", "CH", True),
    ("770", "771", "CO", True),
    ("773", "773", "UY", True),
    ("775", "775", "PE", True),
    ("777", "777", "BO", True),
    ("778", "779", "AR", True),
    ("780", "780", "CL", True),
    ("784", "784", "PY", True),
    ("786", "786", "EC", True),
    ("789", "790", "BR", True),
    ("800", "839", "IT", True),
    ("840", "849", "ES", True),
    ("850", "850", "CU", True),
    ("858", "858", "SK", True),
    ("859", "859", "CZ", True),
    ("860", "860", "RS", True),
    ("865", "865", "MN", True),
    ("867", "867", "KP", True),
    ("868", "869", "TR", True),
    ("870", "879", "NL", True),
    ("880", "881", "KR", True),
    ("883", "883", "MM", True),
    ("884", "884", "KH", True),
    ("885", "885", "TH", True),
    ("888", "888", "SG", True),
    ("890", "890", "IN", True),
    ("893", "893", "VN", True),
    ("896", "896", "PK", True),
    ("899", "899", "ID", True),
    ("900", "919", "AT", True),
    ("930", "939", "AU", True),
    ("940", "949", "NZ", True),
    ("955", "955", "MY", True),
    ("958", "958", "MO", True),
    ("977", "977", None, False),  # Publicaciones periódicas (ISSN)
    ("978", "979", None, False),  # Libros (ISBN) y partituras (ISMN)
    ("980", "980", None, False),  # Recibos de reembolso
    ("981", "984", None, False),  # Cupones
    ("990", "999", None, False),  # Cupones
]

# Agrupaciones que se importan de una sola vez, para no repetir listas de
# países en la línea de comandos. `--region` acepta cualquiera de estas o un
# país ISO suelto (`--region MX`).
REGIONES = {
    "latam": ["MX", "GT", "SV", "HN", "NI", "CR", "PA", "DO", "CO", "VE",
              "EC", "PE", "BO", "CL", "AR", "UY", "PY", "BR", "CU"],
    "norteamerica": ["US", "CA"],
    "usa": ["US"],
    "canada": ["CA"],
    "iberia": ["ES", "PT"],
}


def pais_de(gtin14: str, longitud_original: int = 13) -> tuple[str | None, bool]:
    """Devuelve (país ISO o None, importable) para un GTIN normalizado a 14.

    `longitud_original` es la longitud con la que venía el código ANTES de
    rellenar con ceros, y no es un lujo: el EAN-8 lleva su prefijo GS1 en sus
    propios tres primeros dígitos, no en los del GTIN-14 relleno. El EAN-8
    mexicano `75000011` rellenado es `00000075000011`; leerle el prefijo al
    relleno daría `000` (Estados Unidos) en vez de `750` (México).

    Para las demás longitudes el prefijo se lee sobre la forma de 13 dígitos,
    descartando el indicador de empaque (el primer dígito del GTIN-14).
    """
    if longitud_original == 8:
        # Un EAN-8 que empieza con 0 o 2 es un RCN-8: circulación restringida,
        # el número lo asigna la propia tienda para su marca blanca (GS1
        # General Specifications). El `00000390` es «Sweet and tangy pork» en
        # un supermercado y otra cosa en el de enfrente — jamás al catálogo
        # compartido. Salen 1,060 filas solo del volcado canadiense.
        if gtin14[-8] in ("0", "2"):
            return None, False
        prefijo = gtin14[-8:-5]
    else:
        prefijo = gtin14[1:4]
    for desde, hasta, pais, importable in RANGOS:
        if desde <= prefijo <= hasta:
            return pais, importable
    return None, False


# Nombre del país tal como lo escribe la columna `countries_en` del volcado.
# Hace falta para el criterio «venta»: seleccionar por dónde se VENDE el
# producto y no por quién emitió su prefijo.
#
# Por qué existe este criterio: en Canadá el prefijo no sirve. Solo 177
# productos del volcado llevan prefijo canadiense (754-755) contra 126,467 que
# se venden ahí — las empresas canadienses registran sus códigos con GS1
# Estados Unidos porque el mercado norteamericano está integrado. En México sí
# sirve: `750` es mexicano de verdad.
NOMBRES_EN = {
    "MX": "Mexico", "US": "United States", "CA": "Canada",
    "GT": "Guatemala", "SV": "El Salvador", "HN": "Honduras",
    "NI": "Nicaragua", "CR": "Costa Rica", "PA": "Panama",
    "DO": "Dominican Republic", "CO": "Colombia", "VE": "Venezuela",
    "EC": "Ecuador", "PE": "Peru", "BO": "Bolivia", "CL": "Chile",
    "AR": "Argentina", "UY": "Uruguay", "PY": "Paraguay", "BR": "Brazil",
    "CU": "Cuba", "ES": "Spain", "PT": "Portugal",
}
