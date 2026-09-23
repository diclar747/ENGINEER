-- Baja voluntaria conversacional ("Puente de la Empatía"): estado PAUSED para
-- quien congela su cuenta en vez de borrarla, y marca de si ya usó el respiro
-- de 15 días de gracia (una sola vez por cuenta).
ALTER TYPE "UserStatus" ADD VALUE IF NOT EXISTS 'PAUSED';
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "retentionOfferUsedAt" TIMESTAMP(3);
