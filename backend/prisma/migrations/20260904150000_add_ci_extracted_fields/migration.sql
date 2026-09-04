-- Fields auto-extracted from the CI photo (date of birth, birth place, sex) so the
-- onboarding chat never needs to ask for data that's already printed on the document.
ALTER TABLE "User" ADD COLUMN "dateOfBirth" TEXT;
ALTER TABLE "User" ADD COLUMN "birthPlace" TEXT;
ALTER TABLE "User" ADD COLUMN "sex" TEXT;
