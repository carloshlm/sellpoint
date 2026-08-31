-- F5-DASH-02: la meta mensual de ventas del negocio. NULL = sin meta.
-- Aditiva; la valida el DTO (positiva, 2 decimales), sin CHECK SQL — mismo
-- criterio que country/theme (el catálogo/regla vive en un solo lugar).
ALTER TABLE "tenants" ADD COLUMN "monthly_sales_goal" DECIMAL(14,2);
