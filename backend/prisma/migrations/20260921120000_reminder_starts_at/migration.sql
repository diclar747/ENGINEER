-- Inicio de vigencia del recordatorio: antes de esta fecha no se avisa nada.
-- Permite "desde el 01/10 hasta el 31/10" y que el aviso pare solo al llegar al fin.
ALTER TABLE "MedicationReminder" ADD COLUMN IF NOT EXISTS "startsAt" TIMESTAMP(3);
