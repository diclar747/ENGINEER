-- PRD completion: idiomas PT/EN, Términos, Recovery Key, cifrado at-rest de estudios.

-- Language: agregar Português e Inglés al enum.
ALTER TYPE "Language" ADD VALUE IF NOT EXISTS 'PT';
ALTER TYPE "Language" ADD VALUE IF NOT EXISTS 'EN';

-- User: aceptación de Términos + hash del Recovery Key de 16 caracteres.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "termsAcceptedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "recoveryKeyHash" TEXT;

-- MedicalStudy: marca de contenido OCR/summary cifrado at-rest.
ALTER TABLE "MedicalStudy" ADD COLUMN IF NOT EXISTS "contentEncrypted" BOOLEAN NOT NULL DEFAULT false;

-- RecoveryShard: envelope del PIN cifrado con el Recovery Key, partido en 2 filas.
CREATE TABLE IF NOT EXISTS "RecoveryShard" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "shardIndex" INTEGER NOT NULL,
    "shardData" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RecoveryShard_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "RecoveryShard_userId_shardIndex_key" ON "RecoveryShard"("userId", "shardIndex");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'RecoveryShard_userId_fkey'
    ) THEN
        ALTER TABLE "RecoveryShard"
            ADD CONSTRAINT "RecoveryShard_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- MedicalConditionOption: la tabla estaba en el schema pero nunca en una migración
-- (se creó por `db push` en prod). CREATE ... IF NOT EXISTS la deja consistente sin
-- romper si ya existe.
CREATE TABLE IF NOT EXISTS "MedicalConditionOption" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "labelEs" TEXT NOT NULL,
    "labelGn" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MedicalConditionOption_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "MedicalConditionOption_code_key" ON "MedicalConditionOption"("code");

-- Las condiciones base (Diabetes, Epilepsia, Hipertensión, Marcapasos) ya estaban
-- seedeadas (codes '1'..'5'). Solo se agrega "Válvulas cardíacas" (PRD) y se manda
-- la opción "Ninguna" al final para que no quede intercalada en la lista.
INSERT INTO "MedicalConditionOption" ("id","code","labelEs","labelGn","sortOrder","active","createdAt","updatedAt")
VALUES (gen_random_uuid()::text,'VALVULAS_CARDIACAS','Válvulas cardíacas','Válvulas cardíacas',45,true,now(),now())
ON CONFLICT ("code") DO NOTHING;

UPDATE "MedicalConditionOption" SET "sortOrder" = 999
 WHERE "sortOrder" < 999 AND ("labelEs" ILIKE '%ningun%' OR "labelGn" ILIKE '%mba%eve%');
