-- Complete schema objects present in schema.prisma but absent from migrations.
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "failedPinAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "pinLockedUntil" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "AppSetting" (
  "key" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);

CREATE TABLE IF NOT EXISTS "BotMessage" (
  "key" TEXT NOT NULL,
  "textEs" TEXT NOT NULL,
  "textGn" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BotMessage_pkey" PRIMARY KEY ("key")
);

ALTER TABLE "MedicalConditionOption" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "RecoveryShard" ALTER COLUMN "updatedAt" DROP DEFAULT;
