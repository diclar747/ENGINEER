-- Stores the exact WhatsApp JID (phone-based or @lid) last seen for a user, so
-- outbound messages (OTP, payment/emergency alerts, cron reminders) can reach
-- contacts that WhatsApp only addresses via @lid.
ALTER TABLE "User" ADD COLUMN "whatsappJid" TEXT;
