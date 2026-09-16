-- Catálogo GLOBAL de códigos de barras: la estructura.
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
--   DROP TABLE "global_barcode_catalog";
--   DROP TABLE "gs1_prefix_ranges";
CREATE TABLE "global_barcode_catalog" (
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
  CONSTRAINT "global_barcode_catalog_pkey" PRIMARY KEY ("gtin14"),
  CONSTRAINT "global_barcode_catalog_gtin14_check" CHECK ("gtin14" ~ '^[0-9]{14}$'),
  CONSTRAINT "global_barcode_catalog_source_check"
    CHECK ("source" IN ('open_food_facts', 'tenant_contributed')),
  CONSTRAINT "global_barcode_catalog_confirmations_check" CHECK ("confirmations" >= 0)
);

-- La búsqueda por nombre del alta de producto, cuando el código no aparece.
CREATE INDEX "global_barcode_catalog_search_idx" ON "global_barcode_catalog" ("search" varchar_pattern_ops);
-- Depurar o reimportar una región completa sin recorrer la tabla entera.
CREATE INDEX "global_barcode_catalog_country_idx" ON "global_barcode_catalog" ("country_code");
-- «Dame lo que se vende en Canadá»: la consulta natural con varios mercados.
CREATE INDEX "global_barcode_catalog_market_idx" ON "global_barcode_catalog" ("market_code");

-- Rangos de prefijos GS1 → país emisor. Va en la base, y no en una constante
-- de TypeScript, porque el API la necesita en caliente: cuando un negocio
-- aporta un código que nadie conocía, hay que sellarle su `country_code` sin
-- volver a desplegar. `is_importable` en false marca lo que NUNCA debe entrar
-- al catálogo compartido: los rangos de circulación restringida (etiquetas de
-- báscula, códigos que la propia tienda imprime), que significan cosas
-- distintas en cada negocio, más cupones, ISBN y recibos de reembolso.
CREATE TABLE "gs1_prefix_ranges" (
  "prefix_from"   CHAR(3)  NOT NULL,
  "prefix_to"     CHAR(3)  NOT NULL,
  "country_code"  CHAR(2),
  "is_importable" BOOLEAN  NOT NULL,
  CONSTRAINT "gs1_prefix_ranges_pkey" PRIMARY KEY ("prefix_from"),
  CONSTRAINT "gs1_prefix_ranges_orden_check" CHECK ("prefix_to" >= "prefix_from"),
  CONSTRAINT "gs1_prefix_ranges_pais_check"
    CHECK (("is_importable" AND "country_code" IS NOT NULL)
        OR (NOT "is_importable" AND "country_code" IS NULL))
);

INSERT INTO "gs1_prefix_ranges" ("prefix_from", "prefix_to", "country_code", "is_importable") VALUES
  ('000', '019', 'US', true),
  ('020', '029', NULL, false),
  ('030', '039', 'US', true),
  ('040', '049', NULL, false),
  ('050', '059', NULL, false),
  ('060', '139', 'US', true),
  ('200', '299', NULL, false),
  ('300', '379', 'FR', true),
  ('380', '380', 'BG', true),
  ('383', '383', 'SI', true),
  ('385', '385', 'HR', true),
  ('387', '387', 'BA', true),
  ('389', '389', 'ME', true),
  ('390', '390', 'XK', true),
  ('400', '440', 'DE', true),
  ('450', '459', 'JP', true),
  ('460', '469', 'RU', true),
  ('470', '470', 'KG', true),
  ('471', '471', 'TW', true),
  ('474', '474', 'EE', true),
  ('475', '475', 'LV', true),
  ('476', '476', 'AZ', true),
  ('477', '477', 'LT', true),
  ('478', '478', 'UZ', true),
  ('479', '479', 'LK', true),
  ('480', '480', 'PH', true),
  ('481', '481', 'BY', true),
  ('482', '482', 'UA', true),
  ('483', '483', 'TM', true),
  ('484', '484', 'MD', true),
  ('485', '485', 'AM', true),
  ('486', '486', 'GE', true),
  ('487', '487', 'KZ', true),
  ('488', '488', 'TJ', true),
  ('489', '489', 'HK', true),
  ('490', '499', 'JP', true),
  ('500', '509', 'GB', true),
  ('520', '521', 'GR', true),
  ('528', '528', 'LB', true),
  ('529', '529', 'CY', true),
  ('530', '530', 'AL', true),
  ('531', '531', 'MK', true),
  ('535', '535', 'MT', true),
  ('539', '539', 'IE', true),
  ('540', '549', 'BE', true),
  ('560', '560', 'PT', true),
  ('569', '569', 'IS', true),
  ('570', '579', 'DK', true),
  ('590', '590', 'PL', true),
  ('594', '594', 'RO', true),
  ('599', '599', 'HU', true),
  ('600', '601', 'ZA', true),
  ('603', '603', 'GH', true),
  ('604', '604', 'SN', true),
  ('608', '608', 'BH', true),
  ('609', '609', 'MU', true),
  ('611', '611', 'MA', true),
  ('613', '613', 'DZ', true),
  ('615', '615', 'NG', true),
  ('616', '616', 'KE', true),
  ('618', '618', 'CI', true),
  ('619', '619', 'TN', true),
  ('620', '620', 'TZ', true),
  ('621', '621', 'SY', true),
  ('622', '622', 'EG', true),
  ('624', '624', 'LY', true),
  ('625', '625', 'JO', true),
  ('626', '626', 'IR', true),
  ('627', '627', 'KW', true),
  ('628', '628', 'SA', true),
  ('629', '629', 'AE', true),
  ('630', '630', 'QA', true),
  ('631', '631', 'NA', true),
  ('640', '649', 'FI', true),
  ('690', '699', 'CN', true),
  ('700', '709', 'NO', true),
  ('729', '729', 'IL', true),
  ('730', '739', 'SE', true),
  ('740', '740', 'GT', true),
  ('741', '741', 'SV', true),
  ('742', '742', 'HN', true),
  ('743', '743', 'NI', true),
  ('744', '744', 'CR', true),
  ('745', '745', 'PA', true),
  ('746', '746', 'DO', true),
  ('750', '750', 'MX', true),
  ('754', '755', 'CA', true),
  ('759', '759', 'VE', true),
  ('760', '769', 'CH', true),
  ('770', '771', 'CO', true),
  ('773', '773', 'UY', true),
  ('775', '775', 'PE', true),
  ('777', '777', 'BO', true),
  ('778', '779', 'AR', true),
  ('780', '780', 'CL', true),
  ('784', '784', 'PY', true),
  ('786', '786', 'EC', true),
  ('789', '790', 'BR', true),
  ('800', '839', 'IT', true),
  ('840', '849', 'ES', true),
  ('850', '850', 'CU', true),
  ('858', '858', 'SK', true),
  ('859', '859', 'CZ', true),
  ('860', '860', 'RS', true),
  ('865', '865', 'MN', true),
  ('867', '867', 'KP', true),
  ('868', '869', 'TR', true),
  ('870', '879', 'NL', true),
  ('880', '881', 'KR', true),
  ('883', '883', 'MM', true),
  ('884', '884', 'KH', true),
  ('885', '885', 'TH', true),
  ('888', '888', 'SG', true),
  ('890', '890', 'IN', true),
  ('893', '893', 'VN', true),
  ('896', '896', 'PK', true),
  ('899', '899', 'ID', true),
  ('900', '919', 'AT', true),
  ('930', '939', 'AU', true),
  ('940', '949', 'NZ', true),
  ('955', '955', 'MY', true),
  ('958', '958', 'MO', true),
  ('977', '977', NULL, false),
  ('978', '979', NULL, false),
  ('980', '980', NULL, false),
  ('981', '984', NULL, false),
  ('990', '999', NULL, false)
ON CONFLICT ("prefix_from") DO NOTHING;
