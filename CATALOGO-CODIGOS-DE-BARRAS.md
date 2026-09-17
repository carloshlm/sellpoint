# SellPoint — Catálogo global de códigos de barras

> **Fuente de verdad de la tabla `global_barcode_catalog`**: qué significa cada
> columna, qué entra y qué no, y cómo se carga en cada ambiente. El esquema vive
> en `apps/api/prisma/schema.prisma` (modelos `GlobalBarcodeCatalog` y
> `Gs1PrefixRange`) y en la migración
> `apps/api/prisma/migrations/20260925100000_f10_barcode_global_catalog/`.
> El generador está en `apps/api/prisma/seed/barcode-catalog/` y la carga en
> `infrastructure/scripts/barcode-catalog-load.sh`.

---

## 1. Qué es y por qué existe

Al dar de alta un producto, el negocio escanea el código de barras y el sistema
le **sugiere** el nombre en vez de hacerlo teclear.

La alternativa comercial era el API de [barcodelookup.com](https://www.barcodelookup.com/api):
99 USD al mes por 5,000 llamadas. En una prueba con cinco códigos mexicanos
reales (Sabritas, Lala, Marinela) acertó **cero**, y su único resultado devolvió
los datos de otro producto — un dato falso es peor que un «no encontrado»,
porque el cajero lo guarda sin darse cuenta.

[Open Food Facts](https://world.openfoodfacts.org/data) acertó los cinco, es
gratuito y se descarga entero. Es la fuente de todo lo que hay hoy en la tabla.

**Cobertura real**: alimentos, bebidas, cosmética y productos para mascotas. NO
cubre ferretería, papelería, ropa ni electrónica — ese hueco lo tapan los
propios negocios (ver §7).

---

## 2. Las dos tablas

Ambas son **globales**: sin `tenant_id` y sin RLS, como `permissions` y el
catálogo CIE-10. Un código de barras significa lo mismo en todos los negocios.
Lo que sí es de cada tenant (su precio, su existencia) sigue viviendo en
`product_presentations`.

### 2.1 `global_barcode_catalog`

| Columna | Tipo | Nulo | Qué es |
|---|---|---|---|
| `gtin14` | `CHAR(14)` | no | **Clave primaria.** El GTIN normalizado a 14 dígitos con relleno de ceros (ver §3) |
| `product_name` | `VARCHAR(300)` | no | El nombre que se le sugiere al negocio |
| `brand` | `VARCHAR(120)` | sí | Marca, tal como viene del volcado (puede traer varias separadas por coma) |
| `unit_size` | `VARCHAR(60)` | sí | Contenido declarado: `600 ml`, `450gr` |
| `country_code` | `CHAR(2)` | sí | País que **emitió** el prefijo GS1 (ver §4) |
| `market_code` | `CHAR(2)` | sí | Mercado donde se **vende** (ver §4) |
| `search` | `VARCHAR(300)` | no | `product_name` en minúsculas y sin acentos, para buscar sin teclear tildes |
| `source` | `VARCHAR(24)` | no | `open_food_facts` o `tenant_contributed` (ver §6) |
| `confirmations` | `INTEGER` | no | Cuántos tenants distintos confirmaron este nombre. Default `0` |
| `created_at` | `TIMESTAMPTZ(6)` | no | Default `CURRENT_TIMESTAMP` |
| `updated_at` | `TIMESTAMPTZ(6)` | no | **Sin default** — lo pone Prisma con `@updatedAt`, y las cargas lo escriben con `now()` |

Restricciones que viven en la migración:

```sql
CHECK (gtin14 ~ '^[0-9]{14}$')
CHECK (source IN ('open_food_facts', 'tenant_contributed'))
CHECK (confirmations >= 0)
```

Índices: la PK sobre `gtin14`, uno sobre `search` con `varchar_pattern_ops`
(para `LIKE 'jabon%'`) y uno sobre `country_code` y otro sobre `market_code`.

### 2.2 `gs1_prefix_ranges`

Los 127 rangos de prefijos GS1 → país emisor. Está en la base y no en una
constante de TypeScript porque el API la necesita **en caliente**: cuando un
negocio aporta un código que nadie conocía, hay que sellarle su `country_code`
sin volver a desplegar.

| Columna | Tipo | Qué es |
|---|---|---|
| `prefix_from` | `CHAR(3)` | Inicio del rango. Clave primaria |
| `prefix_to` | `CHAR(3)` | Fin del rango, inclusive |
| `country_code` | `CHAR(2)` | País, o `NULL` si el rango no es importable |
| `is_importable` | `BOOLEAN` | `false` = nunca debe entrar al catálogo (ver §5) |

Hay un CHECK que amarra las dos últimas: importable implica país no nulo, y
viceversa.

---

## 3. La clave es el GTIN-14, no el código escaneado

**Esto es lo más importante del diseño.** El mismo producto se escribe distinto
según el simbolismo:

| Cómo llega | Ejemplo |
|---|---|
| UPC-A, 12 dígitos | `041500750903` |
| EAN-13 (el mismo, con cero al frente) | `0041500750903` |
| GTIN-14 (forma canónica de GS1) | `00041500750903` |

Son **el mismo GTIN**. Si se guardara la cadena tal cual, un lector configurado
para entregar 13 dígitos no encontraría la fila que otro guardó con 12, y el
cajero juraría que la base no sirve.

Rellenando a 14 las cuatro longitudes colapsan en una sola clave. Verificado
contra la base: el mismo producto se encuentra leyendo 12, 13 y 14 dígitos.

**Cómo consultar desde el API:**

```sql
SELECT product_name, brand, unit_size
FROM global_barcode_catalog
WHERE gtin14 = lpad($1, 14, '0');
```

Index Scan, **0.072 ms** con 954,000 filas.

La normalización y el dígito verificador (módulo 10 de GS1) viven en
`apps/api/prisma/seed/barcode-catalog/gtin.py`. Si se implementa en TypeScript,
debe replicar exactamente esas reglas: longitudes válidas 8, 12, 13 y 14;
dígito verificador que cuadre; y rechazar los códigos de puros ceros.

---

## 4. `country_code` y `market_code` son hechos distintos

| Columna | Responde |
|---|---|
| `country_code` | ¿Quién **emitió** el prefijo GS1? |
| `market_code` | ¿En qué mercado se **vende**? |

Una fila con `country_code = 'US'` y `market_code = 'CA'` **no se contradice**:
esa lata se registró en Estados Unidos y se vende en Canadá.

La razón de separarlos: en Canadá el prefijo GS1 no dice nada. Solo **177**
productos del volcado llevan prefijo canadiense (754-755) contra **126,467**
que se venden ahí, porque las empresas canadienses registran sus códigos con
GS1 Estados Unidos — el mercado norteamericano está integrado. En México sí
sirve: el `750` es mexicano de verdad.

Por eso el generador tiene dos criterios de selección:

| `--criterio` | Selecciona por | Se usa en |
|---|---|---|
| `prefijo` (default) | El prefijo GS1 del código | LATAM |
| `venta` | La columna `countries_en` del volcado | Canadá, Estados Unidos |

Cuando se importa por prefijo, `market_code` queda en `NULL` — no se sabe el
mercado. Cuando se importa por venta, se llenan las dos columnas.

Ojo al consultar: **`country_code` NO es «hecho en»**. Sirve para importar y
depurar por región, nunca para mostrarle un origen a un usuario.

---

## 5. Qué NO entra nunca

Hay rangos GS1 que un POS escanea todos los días y que **envenenarían** un
catálogo compartido entre tenants, porque significan cosas distintas en cada
negocio.

| Rango | Qué es |
|---|---|
| `020-029` | Circulación restringida — región geográfica |
| `040-049` | Circulación restringida — dentro de una empresa |
| `200-299` | Circulación restringida — región geográfica |
| `050-059`, `981-984`, `990-999` | Cupones |
| `977`, `978-979` | Publicaciones (ISSN) y libros (ISBN) |
| `980` | Recibos de reembolso |

Son las etiquetas de báscula y los códigos que la propia tienda imprime para su
marca blanca. El `2000000000017` de una carnicería no es el de la tienda de al
lado.

**Caso especial — RCN-8**: un EAN-8 que empieza con **0 o 2** es un
*Restricted Circulation Number*, número que asigna la propia tienda. Pasan el
dígito verificador sin problema, así que el filtro por prefijo no basta: hay que
mirar el primer dígito del código de 8 **antes** de rellenar con ceros. Sin este
filtro entraron 545 filas basura al catálogo canadiense, del tipo
`00000390 → "Sweet and tangy pork"`.

Además se descarta toda fila sin `product_name`: un código sin nombre no le
sugiere nada a nadie.

---

## 6. `source` y la licencia

```
source = 'open_food_facts'     → viene del volcado
source = 'tenant_contributed'  → lo escribió un negocio
```

No es cosmético. Open Food Facts se publica bajo **ODbL**: uso comercial
permitido, **atribución obligatoria**, y *share-alike* sobre la base
**derivada**. Las filas que aportan los negocios son nuestras y **no heredan**
esa obligación.

Separarlas es lo que permite, algún día, exportar o licenciar lo propio sin
arrastrar la licencia ajena. No mezclar orígenes en la misma fila sin marcar
`source`.

**Resuelto (F10-QUICKCAT, 2026-09-16)**: la atribución vive al pie de la
pantalla de **Carga rápida**, que es la primera —y por ahora la única— que
muestra nombres del volcado. Si algún día otra pantalla los muestra, la
atribución tiene que ir con ella: la obligación es de donde se USAN los datos,
no de un pie de página genérico.

---

## 6.5 El idioma del nombre (F10-LANG, 2026-09-16)

Carlos escaneó una botella de aceite de oliva en Canadá y la pantalla le
sugirió **«Huile d'olive vierge extra»**. En la etiqueta, en letras grandes,
dice **«Extra Virgin Olive Oil»**.

**La causa estaba en el volcado, no en el código.** El CSV
`en.openfoodfacts.org.products.csv.gz` tiene exactamente tres campos de nombre
—`product_name`, `abbreviated_product_name` y `generic_name`— y **ninguno por
idioma**. `product_name` es el nombre en el idioma de quien cargó el producto,
que no tiene por qué ser el del mercado donde se vende. Ese aceite es tunecino
(prefijo 619), entró por el volcado canadiense y lo había cargado alguien de
Quebec.

El volcado **JSONL** sí publica `lang`, `product_name_en`, `product_name_fr` y
`product_name_es`. Ese mismo producto tiene los dos nombres allá. Desde
F10-LANG el sembrador lee el JSONL.

| | CSV | JSONL |
|---|---|---|
| Tamaño | 1.2 GB | **12.9 GB** |
| Campos de nombre | 1, sin idioma | uno por idioma, más `lang` |
| País de venta | `countries_en` («Canada, France») | `countries_tags` (`en:canada`) |

**Se transmite y nunca se guarda.** 12.9 GB no caben cómodos en el disco de un
portátil, y no hace falta: `gzip.open` sobre la respuesta HTTP descomprime al
vuelo, línea a línea, y solo se escribe el CSV de salida (unos 30 MB). A
15 MB/s cada región tarda unos 15 minutos de red.

**Solo dos columnas de idioma, y es a propósito.** `name_es` y `name_en` son
los dos idiomas que habla SellPointy, o sea los dos únicos en los que una
sugerencia puede llegarle al usuario *en su idioma*. El francés, el portugués y
los demás viajan en `product_name` con `name_lang` diciendo cuál es — que es
exactamente lo que la pantalla necesita para marcarlos («Nombre en francés» en
vez de «Nombre sugerido»). Una columna `name_fr` sería una columna que nadie
consulta.

**Cuánto arregla, medido sobre el volcado real** (2,056 productos canadienses):

| | |
|---|---|
| Con nombre en inglés | 1,139 |
| Con nombre en francés | 907 |
| De esos 907, **con el inglés también disponible** | **329 (36%)** |

Los otros 578 no tienen nombre en inglés en ningún lado, y eso no lo resuelve
ningún cambio de código. Los va a teclear el negocio que los venda — ver §7.

**LATAM NO se recargó, y es una decisión medida.** El plan era recargar Canadá
y LATAM. Se cargó LATAM en local, se miró el resultado y se revirtió: de 18,296
filas mexicanas el nombre en español de Open Food Facts cambiaba 576, y **la
mitad quedaban peor**.

| Antes | Después de preferir `product_name_es` |
|---|---|
| «Corona Extra 3.2%» | «Corona øl» (danés) |
| «Chicharrón de cerdo (salsa negra)» | «Chicharrón» |
| «Yoplait Griego Sin Azúcar Añadida» | «Yogurt Griego Sin Azúcar Añadía» |
| «800» | «Cubitos De Atún Aleta Amarilla» ✔ |
| «Giant pecans» | «Nuez pecana» ✔ |

Una moneda al aire en el mercado principal no es una mejora. Y hay algo peor
que el empate: **un nombre malo en la casilla del idioma queda atrapado**,
porque la regla de «solo se llena la casilla vacía» impide que un negocio lo
corrija después. En Canadá el cálculo era otro —el francés no le sirve a un
negocio que opera en inglés, así que casi cualquier cambio suma— y por eso ahí
sí se recargó.

Si algún día se quiere reconsiderar: la carga ya está resuelta
(`barcode-catalog-load.sh local latam`) y lo que falta no es código sino una
manera de corregir una casilla que quedó mal.

**Una guarda que se escribió y se quitó.** Descartaba el nombre traducido
cuando medía menos del 60% del original, para atajar un caso real: un producto
cuyo `product_name` era «Salt and pepper calamari» y cuyo `product_name_en` era
«calmar». Se quitó porque tiraba traducciones **correctas**: «Boulettes de
viande à la suédoise» traduce a «Swedish Meatballs», que mide la mitad y es
perfecto. Entre confiar en el campo que el propio volcado etiquetó con el
idioma y confiar en una regla de longitud, gana el campo. El ruido de Open Food
Facts se corrige por el otro lado: el negocio edita la sugerencia.

---

## 7. Cómo se llena solo

**Implementado en F10-QUICKCAT (2026-09-16).** La primera —y hasta hoy única—
pantalla que consulta esta tabla es **Carga rápida**
(`/catalog/products/quick`, ver VISTAS.md §6.5).

**Cascada de `GET /products/barcode-lookup?code=`:**

1. Catálogo del propio tenant, buscando **todas las escrituras del GTIN**
   (`gtinVariants`): los productos guardan el código tal como se escaneó, así
   que `7501055300013` y `07501055300013` son el mismo anaquel.
2. `global_barcode_catalog` por clave primaria. Solo si el paso 1 no acertó: el
   nombre que el negocio ya le puso a su producto gana siempre.
3. Nada — el negocio teclea el nombre, y ese código se aporta.

La aritmética del GTIN se portó de `prisma/seed/barcode-catalog/gtin.py` a
`packages/shared/src/gtin.ts`. **Las dos implementaciones tienen que decidir lo
mismo**: si el sembrador guarda bajo una clave y el API busca bajo otra, la
tabla tiene 953,969 productos que nadie encuentra. El test de `gtin.ts` fija
los valores que decide el Python.

**Reglas:**

- Se **sugiere**, nunca se autocompleta en silencio. El nombre llega editable, y
  con el IDIOMA en el que está: si no es el del negocio, la línea lo dice.
- Si el negocio teclea el nombre de un código desconocido, se inserta con
  `source = 'tenant_contributed'`, `confirmations = 1`, el sello de quién lo
  aportó (`contributed_by_tenant_id`) y el nombre en la casilla de **su**
  idioma.
- **Nunca se edita una casilla que ya tenga algo** — ni el nombre, ni la marca,
  ni el contador. Desde F10-LANG la regla de Carlos se mudó de nivel: de la
  FILA a la CASILLA. Una casilla de idioma **vacía** sí se llena, y ese es el
  camino que más vale de todo el módulo: de los productos canadienses en
  francés, dos tercios no tienen inglés en Open Food Facts, y los teclea el
  negocio que los vende. Sin esto, ese trabajo se quedaba en su catálogo
  privado y el siguiente negocio volvía a ver el francés.
- El filtro de lo que nunca entra **es el JOIN contra `gs1_prefix_ranges`, no
  un `if`**: así ningún llamador futuro puede olvidarse de aplicarlo. Quedan
  fuera los rangos de circulación restringida, cupones, ISBN/ISSN y RCN-8.
- El aporte corre en **su propia transacción, después del COMMIT** del alta, y
  no lanza nunca: si falla, el negocio se queda con sus productos y la
  plataforma pierde una fila. Al revés sería indefendible en el mostrador.

⚠️ **La columna del sello NO se puede llamar `tenant_id`.** `purge_tenant`
recorre `information_schema` y borra de toda tabla base con una columna así:
eliminar un negocio se llevaría filas del catálogo que usan todos los demás, en
silencio. Hay un spec de integración que ejecuta la purga de verdad y verifica
que la fila siga.

**Pendiente**: `confirmations` se queda en 1 y no vuelve a moverse. Contar
negocios DISTINTOS exige un libro mayor (`global_barcode_confirmations`) para
que reenviar el mismo borrador no infle el número. Mientras no exista, ordenar
las sugerencias por `confirmations` no dice nada.

Ese último punto es el que convierte esto en un activo propio: Open Food Facts
no tiene ferretería ni papelería, pero los negocios sí. Un nombre que
confirmaron 40 tiendas vale más que cualquier base de pago, y el costo por
consulta **tiende a cero** conforme crece la plataforma.

Cuando exista el libro mayor, la sugerencia debe ordenarse por `confirmations`
descendente: así un dato malo de un solo negocio nunca le gana a uno que muchos
validaron.

---

## 8. Estado actual

Cargado en **local, sandbox y producción** con cifras idénticas:

| Origen | Productos |
|---|---|
| Estados Unidos (`market_code = 'US'`) | 746,114 |
| Canadá (`market_code = 'CA'`) | 105,866 |
| LATAM (por prefijo, `market_code IS NULL`) | 101,989 |
| **Total** | **953,969** |

Dentro de LATAM: Brasil 30,565 · México 17,269 · Argentina 12,874 ·
Colombia 9,292 · Chile 7,949 · Perú 4,098 · Venezuela 3,602 · Costa Rica 2,774 ·
Ecuador 2,610 · Bolivia 1,737 · Honduras 1,538 · Uruguay 1,364 ·
Guatemala 1,324 · Rep. Dominicana 1,238 · El Salvador 1,182 · Panamá 862 ·
Paraguay 773 · Nicaragua 591 · Cuba 347.

**Peso**: tabla 244 MB (143 MB de datos + 101 MB de índices). `sellpoint_prod`
completa: 267 MB.

Los totales del archivo generado y los insertados difieren un poco por los
conflictos entre regiones: un producto vendido en Canadá que ya existía con
prefijo latinoamericano no se duplica.

---

## 9. Cargar o refrescar

**Los datos NO viajan en el repo.** En formato migración pesaban 125 MB contra
30 MB de todo el historial de `.git`, y git no olvida: cada clon y cada CI lo
pagarían para siempre por datos que se regeneran con un comando.

Lo que sí viaja: la estructura, el generador y el script de carga (56 KB).

```bash
# Se baja una vez (1.2 GB) y se reusa entre regiones
export BARCODE_VOLCADO=/tmp/volcado.csv.gz

infrastructure/scripts/barcode-catalog-load.sh <ambiente> <región> [--criterio venta]
```

| Ambiente | Contenedor | Base |
|---|---|---|
| `local` | `sellpoint-postgres` | `sellpoint_dev` |
| `sandbox` | `sellpoint-sandbox-postgres` | `sellpoint_sandbox` |
| `prod` | `sellpoint-postgres` | `sellpoint_prod` |

Sandbox y producción **comparten servidor** (alias SSH `sellpoint-prod`) y se
distinguen solo por contenedor y base.

Las tres regiones que están cargadas hoy:

```bash
infrastructure/scripts/barcode-catalog-load.sh prod latam
infrastructure/scripts/barcode-catalog-load.sh prod canada --criterio venta
infrastructure/scripts/barcode-catalog-load.sh prod usa    --criterio venta
```

**Es idempotente**: correrlo dos veces no duplica ni pisa nada. El `INSERT` usa
`ON CONFLICT (gtin14) DO NOTHING`, que además garantiza lo importante — **un
nombre que un negocio confirmó a mano jamás se sobrescribe con uno de Open Food
Facts**.

Regiones disponibles en `gs1-prefixes.py`: `latam`, `norteamerica`, `usa`,
`canada`, `iberia`, o un país ISO suelto (`--region MX`).

---

## 10. Trampas verificadas

Cosas que ya costaron un rato y no hay que volver a descubrir:

| Trampa | Qué pasa |
|---|---|
| Procesar el CSV del volcado por líneas | Trae saltos de línea **dentro** de los campos: 3,300 filas reales contra 5,528 líneas físicas. `awk`, `grep` y `cut` parten registros a la mitad. Hay que usar un parser de CSV de verdad |
| `curl` sin `-L` | `static.openfoodfacts.org` responde **302** hacia S3. Sin seguir la redirección se baja un HTML de 145 bytes y `gunzip` dice «unknown compression format» |
| El export por país del formulario web | `cgi/search.pl` con `download=on` se corta a los ~180 s devolviendo **HTTP 200 con datos incompletos**. Falla en silencio. No usarlo |
| `csv.writer` de Python con `COPY` | Escribe `\r\n` por omisión. `COPY ... FORMAT csv` deduce el fin de línea de la primera línea y después lo exige: el terminador `\.` con `\n` mata la carga con «unquoted newline found in data» señalando la línea equivocada. Hay que pasar `lineterminator="\n"` |
| `COPY` directo a la tabla final | No sabe de conflictos y muere con el primer GTIN repetido. Va a una tabla temporal y de ahí un `INSERT ... ON CONFLICT DO NOTHING` |
| Poner `DEFAULT` a `updated_at` | La convención del repo lo deja sin default (lo pone Prisma con `@updatedAt`). Ponérselo crea deriva contra el schema; las cargas deben escribir `now()` explícito |
| Acceder al CSV por posición de columna | El orden ha cambiado entre versiones del volcado. Siempre por nombre (`DictReader`) |
| Creer que `product_name` está en el idioma del mercado | **No lo está.** Es el idioma de quien cargó el producto. Un aceite vendido en Canadá llegó en francés durante un mes. El CSV no publica los nombres por idioma; el JSONL sí (§6.5) |
| Buscar `countries_en` en el JSONL | No existe. El JSONL trae `countries_tags` con etiquetas normalizadas y prefijo de idioma (`en:canada`), no el texto libre del CSV |
| Filtrar el idioma con la API de búsqueda de Open Food Facts | `?lang=fr` y `?lang=en` devuelven **el mismo `count`**: el filtro se ignora en silencio. Para medir idiomas hay que mirar el volcado |

---

## 11. Refrescar en el futuro

El volcado de Open Food Facts se regenera cada noche. Para actualizar, basta
volver a correr el script: lo nuevo entra y lo existente se respeta.

Si algún día conviene algo incremental, hay **deltas diarios de los últimos 14
días** en `https://static.openfoodfacts.org/data/delta/index.txt`.

Otros volcados de la misma organización, mucho más chicos y aún sin importar:

| Volcado | Tamaño | Contenido |
|---|---|---|
| Open Beauty Facts | 17 MB | Cosmética |
| Open Pet Food Facts | 3 MB | Mascotas |
| Open Products Facts | 6 MB | Otros productos |

Son tan pequeños que se importan completos sin filtrar por región.
