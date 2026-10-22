-- F10-THEME-05 (Carlos, 2026-10-22): el catálogo de temas se consolida.
--
-- Claro toma el estilo de Niebla Cobalto y Oscuro el de Grafito Líquido, así
-- que esos dos dejan de existir aparte, y se retiran Uva, Esmeralda y Carbón.
-- El enum del API ya no acepta ninguno de los cinco.
--
-- En producción ningún negocio los tenía el 2026-10-22 (consulta de ese día),
-- pero uno pudo elegirlos entre la consulta y el deploy. Sin esta migración,
-- el web pintaría ese negocio con el tema por defecto sin avisar. Cada uno va
-- al tema que más se le parece, y la migración es idempotente.
UPDATE tenants SET theme = 'light' WHERE theme IN ('cobalt', 'grape');
UPDATE tenants SET theme = 'dark' WHERE theme IN ('liquid', 'charcoal');
UPDATE tenants SET theme = 'jade' WHERE theme = 'emerald';
