-- Historial persistente del bot de WhatsApp: hasta ahora "Movimientos del bot (en vivo)"
-- vivía solo en memoria (buffer de 500 eventos, se perdía al reiniciar, sin
-- borrado ni paginación real). Esta tabla respalda el panel admin de mensajes:
-- lista completa, filtro por fecha/estado/teléfono, paginación y borrado.

CREATE TABLE IF NOT EXISTS "BotMessageLog" (
    "id"     TEXT NOT NULL,
    "ts"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dir"    TEXT NOT NULL,
    "jid"    TEXT,
    "phone"  TEXT,
    "kind"   TEXT,
    "text"   TEXT,
    "status" TEXT,
    "msgId"  TEXT,
    "error"  TEXT,
    CONSTRAINT "BotMessageLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "BotMessageLog_ts_idx" ON "BotMessageLog"("ts");
CREATE INDEX IF NOT EXISTS "BotMessageLog_phone_idx" ON "BotMessageLog"("phone");
CREATE INDEX IF NOT EXISTS "BotMessageLog_status_idx" ON "BotMessageLog"("status");
CREATE INDEX IF NOT EXISTS "BotMessageLog_dir_idx" ON "BotMessageLog"("dir");
CREATE INDEX IF NOT EXISTS "BotMessageLog_msgId_idx" ON "BotMessageLog"("msgId");
