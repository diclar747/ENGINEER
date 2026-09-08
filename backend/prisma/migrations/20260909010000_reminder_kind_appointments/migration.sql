-- Recordatorios: soportar turnos/citas médicas además de la medicación recurrente.
ALTER TABLE "MedicationReminder" ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'MED';
ALTER TABLE "MedicationReminder" ADD COLUMN IF NOT EXISTS "whenAt" TIMESTAMP(3);
ALTER TABLE "MedicationReminder" ALTER COLUMN "times" SET DEFAULT '[]';
