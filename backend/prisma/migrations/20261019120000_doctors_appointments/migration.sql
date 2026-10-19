-- Módulo de Doctores + reservas (citas con doctor del catálogo)

-- Estado de una reserva
DO $$ BEGIN
  CREATE TYPE "AppointmentStatus" AS ENUM ('PENDING_PAYMENT', 'BOOKED', 'CANCELLED', 'DONE', 'NO_SHOW');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Doctores del catálogo (se cargan desde /admin → Doctores)
CREATE TABLE IF NOT EXISTS "Doctor" (
  "id"                TEXT NOT NULL,
  "fullName"          TEXT NOT NULL,
  "specialties"       TEXT NOT NULL DEFAULT '[]',
  "consultationCost"  DOUBLE PRECISION,
  "currency"          TEXT NOT NULL DEFAULT 'PYG',
  "whatsappNumber"    TEXT NOT NULL,
  "schedule"          TEXT NOT NULL DEFAULT '[]',
  "slotMinutes"       INTEGER NOT NULL DEFAULT 30,
  "doctorLeadMinutes" INTEGER NOT NULL DEFAULT 120,
  "active"            BOOLEAN NOT NULL DEFAULT true,
  "notes"             TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Doctor_pkey" PRIMARY KEY ("id")
);

-- Reservas / turnos con un doctor
CREATE TABLE IF NOT EXISTS "Appointment" (
  "id"                TEXT NOT NULL,
  "doctorId"          TEXT NOT NULL,
  "userId"            TEXT,
  "patientName"       TEXT NOT NULL,
  "patientPhone"      TEXT NOT NULL,
  "whenAt"            TIMESTAMP(3) NOT NULL,
  "durationMinutes"   INTEGER NOT NULL DEFAULT 30,
  "status"            "AppointmentStatus" NOT NULL DEFAULT 'BOOKED',
  "cost"              DOUBLE PRECISION,
  "currency"          TEXT NOT NULL DEFAULT 'PYG',
  "source"            TEXT NOT NULL DEFAULT 'BOT',
  "patientReminderId" TEXT,
  "doctorNotifiedAt"  TIMESTAMP(3),
  "doctorLastSlot"    TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Appointment_doctorId_idx" ON "Appointment"("doctorId");
CREATE INDEX IF NOT EXISTS "Appointment_userId_idx" ON "Appointment"("userId");
CREATE INDEX IF NOT EXISTS "Appointment_whenAt_idx" ON "Appointment"("whenAt");
CREATE INDEX IF NOT EXISTS "Appointment_status_idx" ON "Appointment"("status");

DO $$ BEGIN
  ALTER TABLE "Appointment"
    ADD CONSTRAINT "Appointment_doctorId_fkey"
    FOREIGN KEY ("doctorId") REFERENCES "Doctor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "Appointment"
    ADD CONSTRAINT "Appointment_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Cobro de una consulta: PaymentOrder puede apuntar a una reserva
ALTER TABLE "PaymentOrder" ADD COLUMN IF NOT EXISTS "appointmentId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "PaymentOrder_appointmentId_key" ON "PaymentOrder"("appointmentId");

DO $$ BEGIN
  ALTER TABLE "PaymentOrder"
    ADD CONSTRAINT "PaymentOrder_appointmentId_fkey"
    FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
