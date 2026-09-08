-- Medicación en curso del titular (lo que está tomando ahora).
-- JSON array: [{ name, dose, frequency, since, source, addedAt }].
-- Se carga por WhatsApp (opción "Cargar medicamento" / al confirmar una receta) o desde la web.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "currentMedications" TEXT;
