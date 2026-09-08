-- Prompts de IA editables desde /admin → IA
CREATE TABLE IF NOT EXISTS "AiPrompt" (
  "id"        TEXT NOT NULL,
  "name"      TEXT NOT NULL,
  "scope"     TEXT NOT NULL DEFAULT 'GENERAL',
  "content"   TEXT NOT NULL,
  "active"    BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AiPrompt_pkey" PRIMARY KEY ("id")
);

-- Recordatorios de toma de medicación
CREATE TABLE IF NOT EXISTS "MedicationReminder" (
  "id"           TEXT NOT NULL,
  "userId"       TEXT NOT NULL,
  "medication"   TEXT NOT NULL,
  "dose"         TEXT,
  "times"        TEXT NOT NULL,
  "active"       BOOLEAN NOT NULL DEFAULT true,
  "lastSentAt"   TIMESTAMP(3),
  "lastSentSlot" TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MedicationReminder_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "MedicationReminder_active_idx" ON "MedicationReminder"("active");

DO $$ BEGIN
  ALTER TABLE "MedicationReminder"
    ADD CONSTRAINT "MedicationReminder_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
