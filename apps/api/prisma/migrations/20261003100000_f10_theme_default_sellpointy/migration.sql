-- F10-THEME-04 (Carlos, 2026-09-26): SellPointy es el tema por defecto del
-- producto — inicio de sesión, registro y wizard.
--
-- 1. Los negocios que YA existen sin tema elegido (NULL) se veían en Claro,
--    porque el web pintaba NULL con su default de entonces. Se fijan en
--    'light' para que el cambio de default NO les cambie el aspecto sin
--    avisar: siguen viendo exactamente lo mismo.
UPDATE tenants SET theme = 'light' WHERE theme IS NULL;

-- 2. Los negocios nuevos nacen con el tema de la marca guardado en la base.
--    Así un NULL deja de significar «lo que el web tenga por default hoy», y
--    mover ese default en el futuro ya no repinta a nadie.
ALTER TABLE tenants ALTER COLUMN theme SET DEFAULT 'sellpointy';
