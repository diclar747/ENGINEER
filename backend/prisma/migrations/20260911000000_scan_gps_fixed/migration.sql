-- Escaneo de emergencia en 2 fases: marca cuando lat/lng vienen del GPS del navegador
-- (POST /emergency/:token/location), no del centroide aproximado de geoip.
ALTER TABLE "ScanAuditLog" ADD COLUMN IF NOT EXISTS "gpsFixed" BOOLEAN NOT NULL DEFAULT false;
