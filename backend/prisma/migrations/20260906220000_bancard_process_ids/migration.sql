-- Lista (JSON) de todos los shop_process_id que se generaron para una orden Bancard.
-- El /checkout regenera la sesión de Bancard cuando el process_id vence; solo uno termina
-- pagado, así que hay que consultar la confirmación de todos. Idempotente.
ALTER TABLE "PaymentOrder" ADD COLUMN IF NOT EXISTS "bancardProcessIds" TEXT;
