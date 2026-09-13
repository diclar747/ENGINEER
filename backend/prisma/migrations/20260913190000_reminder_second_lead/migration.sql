-- Segundo aviso automático para turnos/citas (ej. 10 min antes, además del principal
-- que el usuario haya pedido o el default de 30 min) — un solo registro, un segundo offset.
ALTER TABLE "MedicationReminder" ADD COLUMN IF NOT EXISTS "secondLeadMinutes" INTEGER;
