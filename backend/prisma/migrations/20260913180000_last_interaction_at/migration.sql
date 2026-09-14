-- Marca de "último mensaje entrante procesado" del bot de WhatsApp, para detectar
-- cuando un usuario abandonó un registro/sub-flujo a mitad de camino (timeout de inactividad).
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "lastInteractionAt" TIMESTAMP(3);
