#!/usr/bin/env python3
"""
F9-CLINIC-HC-22 — genera la migración del catálogo CIE-10 (México) a partir
del catálogo maestro de diagnósticos de la DGIS (Secretaría de Salud).

Fuente oficial: http://www.dgis.salud.gob.mx/contenidos/intercambio/diagnostico_gobmx.html
Archivo:        DIAGNOSTICOS_YYYYMMDD.zip (dentro, un XLSX con la hoja CIE-*).
Datos abiertos del Gobierno de México (Libre Uso MX).

Uso:
  python3 apps/api/prisma/seed/icd10/build-migration.py <DIAGNOSTICOS_20240416.xlsx> <version YYYY-MM-DD> <carpeta de la migración>

Solo biblioteca estándar: el XLSX es un ZIP con XML y no hace falta más. Es
un generador de UN SOLO USO por versión del catálogo: el SQL resultante es la
fuente de verdad que viaja en `prisma/migrations`; este script existe para
poder repetir el proceso cuando la DGIS publique una versión nueva.

Reglas:
- Fuera la fila `9999` (marcador de la DGIS, no es un código).
- `code` es el código CIE-10 con punto (`J069` → `J06.9`); las claves de
  presentación a cuatro caracteres con `X` (`A33X`) son la categoría de tres
  (`A33`): la X no existe en la CIE-10 de la OMS.
- Si dos filas caen en el mismo `code` (la categoría y su presentación con X),
  gana la vigente (`VALID = SI`), después la no borrada (`RUBRICA_TYPE ≠ B`),
  después la clave más corta.
- `is_valid` = `VALID = SI`: solo esas se ofrecen al codificar.
- `search` = título en minúsculas y sin acentos, para buscar sin teclearlos.
- `sex` = `F` (MUJER) / `M` (HOMBRE) / NULL; `chapter` = el romano de DGIS.
"""
import re
import sys
import unicodedata
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
T = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t"
LOTE = 500


def leer_hoja(xlsx: Path) -> list[dict[str, str]]:
    z = zipfile.ZipFile(xlsx)
    ss = [
        "".join(t.text or "" for t in si.iter(T))
        for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall("m:si", NS)
    ]
    hoja = ET.fromstring(z.read("xl/worksheets/sheet1.xml"))
    filas = []
    for r in hoja.find("m:sheetData", NS).findall("m:row", NS):
        celdas = {}
        for c in r.findall("m:c", NS):
            col = re.match(r"[A-Z]+", c.get("r")).group(0)
            v = c.find("m:v", NS)
            if v is None:
                celdas[col] = ""
            else:
                celdas[col] = ss[int(v.text)] if c.get("t") == "s" else v.text
        filas.append(celdas)
    cab = {v: k for k, v in filas[0].items()}
    return [{nombre: f.get(col, "") for nombre, col in cab.items()} for f in filas[1:]]


def limpiar(texto: str) -> str:
    return re.sub(r"\s+", " ", texto.replace("\xa0", " ")).strip()


def sin_acentos(texto: str) -> str:
    return "".join(
        ch for ch in unicodedata.normalize("NFD", texto) if unicodedata.category(ch) != "Mn"
    )


def code_de(clave: str) -> str:
    clave = clave.upper()
    if len(clave) == 3:
        return clave
    if clave[3] == "X":
        return clave[:3]
    return f"{clave[:3]}.{clave[3:]}"


def sql(texto: str) -> str:
    return "'" + texto.replace("'", "''") + "'"


def main() -> None:
    xlsx, version, carpeta = Path(sys.argv[1]), sys.argv[2], Path(sys.argv[3])
    filas = leer_hoja(xlsx)
    mejores: dict[str, tuple[tuple[int, int, int], dict[str, str]]] = {}
    for f in filas:
        clave = f["CATALOG_KEY"].strip().upper()
        if not re.fullmatch(r"[A-Z]\d{2}[0-9X]?", clave):
            continue
        code = code_de(clave)
        prioridad = (
            0 if f["VALID"] == "SI" else 1,
            0 if f["RUBRICA_TYPE"] != "B" else 1,
            len(clave),
        )
        if code not in mejores or prioridad < mejores[code][0]:
            mejores[code] = (prioridad, f)
    registros = []
    for code in sorted(mejores):
        f = mejores[code][1]
        titulo = limpiar(f["NOMBRE"])
        sexo = {"MUJER": "F", "HOMBRE": "M"}.get(f["LSEX"])
        registros.append(
            (
                code,
                f["CATALOG_KEY"].strip().upper(),
                titulo,
                sin_acentos(titulo).lower(),
                f["CLAVE_CAPITULO"] if f["CLAVE_CAPITULO"] != "NO" else "",
                sexo,
                f["VALID"] == "SI",
            )
        )
    carpeta.mkdir(parents=True, exist_ok=True)
    salida = carpeta / "migration.sql"
    with salida.open("w", encoding="utf-8") as out:
        out.write(
            f"""-- F9-CLINIC-HC-22 (2026-09-09): el catálogo CIE-10 de México, GLOBAL.
--
-- Fuente: catálogo maestro de diagnósticos de la DGIS (Secretaría de Salud),
-- versión {version} (DIAGNOSTICOS_{version.replace("-", "")}.zip), datos abiertos
-- del Gobierno de México. Generado por prisma/seed/icd10/build-migration.py:
-- {len(registros)} códigos ({sum(1 for r in registros if r[6])} vigentes para codificar).
--
-- Sin tenant_id y sin RLS a propósito, como `permissions`: es el mismo
-- catálogo para todos los negocios. `code` lleva punto (J06.9) y es el que ve
-- el médico; `dgis_key` es la clave compacta de la DGIS (J069, A33X) para
-- intercambiar con sistemas mexicanos. `search` es el título sin acentos y
-- en minúsculas: se busca «infeccion» y se encuentra «INFECCIÓN».
--
-- Deshacer, si hiciera falta:
--   DROP TABLE "medical_clinic_icd10_codes";
CREATE TABLE "medical_clinic_icd10_codes" (
  "code"     VARCHAR(8)   NOT NULL,
  "dgis_key" VARCHAR(4)   NOT NULL,
  "title"    VARCHAR(300) NOT NULL,
  "search"   VARCHAR(300) NOT NULL,
  "chapter"  VARCHAR(8),
  "sex"      CHAR(1),
  "is_valid" BOOLEAN      NOT NULL DEFAULT true,
  CONSTRAINT "medical_clinic_icd10_codes_pkey" PRIMARY KEY ("code"),
  CONSTRAINT "medical_clinic_icd10_codes_dgis_key_key" UNIQUE ("dgis_key"),
  CONSTRAINT "medical_clinic_icd10_codes_sex_check" CHECK ("sex" IS NULL OR "sex" IN ('F', 'M'))
);

CREATE INDEX "medical_clinic_icd10_codes_valid_search_idx"
  ON "medical_clinic_icd10_codes" ("search") WHERE "is_valid";

"""
        )
        for i in range(0, len(registros), LOTE):
            out.write(
                'INSERT INTO "medical_clinic_icd10_codes" ("code", "dgis_key", "title", "search", "chapter", "sex", "is_valid") VALUES\n'
            )
            lote = registros[i : i + LOTE]
            lineas = []
            for code, clave, titulo, busqueda, capitulo, sexo, vigente in lote:
                lineas.append(
                    "  ("
                    + ", ".join(
                        [
                            sql(code),
                            sql(clave),
                            sql(titulo),
                            sql(busqueda),
                            sql(capitulo) if capitulo else "NULL",
                            sql(sexo) if sexo else "NULL",
                            "true" if vigente else "false",
                        ]
                    )
                    + ")"
                )
            out.write(",\n".join(lineas) + "\nON CONFLICT (\"code\") DO NOTHING;\n\n")
    print(f"{salida}: {len(registros)} códigos, {sum(1 for r in registros if r[6])} vigentes")


if __name__ == "__main__":
    main()
