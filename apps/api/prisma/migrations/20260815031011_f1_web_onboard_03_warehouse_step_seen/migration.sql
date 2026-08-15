-- F1-WEB-ONBOARD-03 (apply-progress Deviation 6): NOT NULL con DEFAULT
-- false — aditiva, un tenant preexistente migra directo a `false` (sin
-- pasar por el paso 3 del wizard). NO es dato real de almacén (F2, D2): es
-- la única señal server-side de que el paso 3 (placeholder) ya se recorrió.
-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "warehouse_step_seen" BOOLEAN NOT NULL DEFAULT false;
