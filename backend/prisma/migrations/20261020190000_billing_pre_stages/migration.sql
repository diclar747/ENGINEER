-- Cobranzas: avisos de vencimiento a 3 y 1 día antes (además del de 5 días)
ALTER TYPE "NotificationStage" ADD VALUE IF NOT EXISTS 'D_MINUS_3';
ALTER TYPE "NotificationStage" ADD VALUE IF NOT EXISTS 'D_MINUS_1';
