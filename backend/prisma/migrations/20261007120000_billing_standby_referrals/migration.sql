-- Cobranzas: etapa "20 días sin pagar → cuenta en espera"
ALTER TYPE "NotificationStage" ADD VALUE IF NOT EXISTS 'D_PLUS_20_STANDBY';

-- Promo "traé un cliente y ganá un mes gratis"
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "referralCode" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "referredById" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "referralRewardedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX IF NOT EXISTS "User_referralCode_key" ON "User"("referralCode");

-- Comprobante de pago por alias / transferencia
ALTER TABLE "PaymentOrder" ADD COLUMN IF NOT EXISTS "proofFile" TEXT;
ALTER TABLE "PaymentOrder" ADD COLUMN IF NOT EXISTS "proofAt" TIMESTAMP(3);
