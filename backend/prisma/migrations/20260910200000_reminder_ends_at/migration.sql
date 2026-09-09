-- Recordatorio de medicación con fin de tratamiento ("tomar por 3 días").
ALTER TABLE "MedicationReminder" ADD COLUMN IF NOT EXISTS "endsAt" TIMESTAMP(3);
