#!/usr/bin/env python3
"""Normalización y validación de GTIN (EAN-8/12/13/14, UPC-A).

Por qué normalizar a 14 dígitos: el MISMO producto se escribe distinto según
el simbolismo. Una lata estadounidense trae UPC-A de 12 (`041500750903`); la
misma lata en un catálogo europeo viaja como EAN-13 con un cero al frente
(`0041500750903`). Si guardamos la cadena tal cual, el lector del cajero en
México lee 13 y no encuentra la fila que guardamos con 12. Son el mismo GTIN.

La forma canónica de GS1 es el GTIN-14: se rellena con ceros a la izquierda.
Ahí las cuatro longitudes colapsan en una sola clave y la comparación deja de
depender de con qué lector se escaneó.

El dígito verificador (módulo 10) es lo que separa un código real de un dedazo
o de una fila a medio capturar. Open Food Facts es colaborativo y trae ruido:
sin este filtro, entra basura al catálogo que compartimos entre todos los
negocios.
"""
from __future__ import annotations

LONGITUDES_VALIDAS = (8, 12, 13, 14)


def digito_verificador(cuerpo: str) -> int:
    """Módulo 10 de GS1 sobre el código SIN su último dígito.

    Se pondera de derecha a izquierda 3,1,3,1… — la posición se cuenta desde
    el final, así que no depende de la longitud.
    """
    suma = 0
    for i, c in enumerate(reversed(cuerpo)):
        suma += int(c) * (3 if i % 2 == 0 else 1)
    return (10 - suma % 10) % 10


def normalizar(codigo: str) -> str | None:
    """Devuelve el GTIN-14 canónico, o None si el código no es un GTIN válido.

    Rechaza: lo que no sea dígitos, las longitudes que no son de GTIN, el
    dígito verificador que no cuadra y los códigos de puros ceros (que
    aparecen en los volcados como relleno y pasarían el módulo 10).
    """
    if codigo is None:
        return None
    limpio = codigo.strip().replace(" ", "").replace("-", "")
    if not limpio.isdigit() or len(limpio) not in LONGITUDES_VALIDAS:
        return None
    if digito_verificador(limpio[:-1]) != int(limpio[-1]):
        return None
    if set(limpio) == {"0"}:
        return None
    return limpio.zfill(14)


def clasificar(codigo: str, prefijos) -> tuple[str, str, bool] | None:
    """Normaliza y ubica un código en un solo paso.

    Devuelve (gtin14, país ISO o '', importable) o None si el código no es un
    GTIN válido. Se pasa el módulo de prefijos por parámetro para que este
    archivo no dependa de un nombre con guion, que no se puede importar.
    """
    limpio = (codigo or "").strip().replace(" ", "").replace("-", "")
    gtin14 = normalizar(limpio)
    if gtin14 is None:
        return None
    pais, importable = prefijos.pais_de(gtin14, len(limpio))
    return gtin14, pais or "", importable
