-- F1-WEB-ONBOARD-01: paso 1 del wizard (dirección) y paso 2 (elección de
-- plantilla, placeholder de F2). Ambas nullable — aditiva, un tenant
-- preexistente sigue operando con las dos en NULL (spec: "Tenant preexistente
-- sin datos nuevos").
-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "address" TEXT,
ADD COLUMN     "template_choice" TEXT;
