-- Recordatorios de medicación: modo por intervalo ("cada N horas" anclado en la última toma)
-- + anticipación configurable del aviso (turnos y pre-aviso de medicación).
ALTER TABLE "MedicationReminder" ADD COLUMN IF NOT EXISTS "scheduleKind"  TEXT NOT NULL DEFAULT 'CLOCK';
ALTER TABLE "MedicationReminder" ADD COLUMN IF NOT EXISTS "intervalHours" INTEGER;
ALTER TABLE "MedicationReminder" ADD COLUMN IF NOT EXISTS "anchorAt"      TIMESTAMP(3);
ALTER TABLE "MedicationReminder" ADD COLUMN IF NOT EXISTS "nextDoseAt"    TIMESTAMP(3);
ALTER TABLE "MedicationReminder" ADD COLUMN IF NOT EXISTS "leadMinutes"   INTEGER NOT NULL DEFAULT 10;

CREATE INDEX IF NOT EXISTS "MedicationReminder_userId_idx" ON "MedicationReminder"("userId");
