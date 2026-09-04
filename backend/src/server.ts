import express from 'express';
import cors from 'cors';
import path from 'path';
import { config } from './config';
import routes from './routes';
import { connectDB } from './database/prisma';
import { StorageService } from './storage/storage.service';
import { setupSwagger } from './swagger/swagger';
import { whatsappBot } from './whatsapp/baileys.client';
import { CronService } from './services/cron.service';
import { PushService } from './services/push.service';
import { globalLimiter } from './security/rate-limit';

const app = express();

// Behind a single reverse proxy in prod (Nginx/Render/Fly). Lets express-rate-limit
// and req.ip read X-Forwarded-For correctly without trusting the whole chain.
app.set('trust proxy', 1);

// Middleware
const corsOrigins = config.cors.origins;
app.use(
  cors({
    origin:
      corsOrigins.includes('*')
        ? '*'
        : (origin, cb) => {
            // allow same-origin / curl / server-to-server (no Origin header) and any allow-listed origin
            if (!origin || corsOrigins.includes(origin)) return cb(null, true);
            cb(new Error(`Origen no permitido por CORS: ${origin}`));
          },
    credentials: !corsOrigins.includes('*'),
  })
);
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use('/api', globalLimiter);

// Static uploads serving
app.use('/uploads', express.static(config.storage.uploadDir));

// API Routes
app.use('/api', routes);

// Swagger Documentation
setupSwagger(app);

// Root healthcheck
app.get('/', (req, res) => {
  res.json({
    name: 'Doorway Cortex Bio-Pass API',
    status: 'online',
    version: '1.0.0',
    documentation: '/api/docs',
    whatsappBot: whatsappBot.getStatus().connected ? 'connected' : 'disconnected / awaiting scan',
  });
});

async function bootstrap() {
  console.log('🚀 Starting Doorway Cortex Bio-Pass Backend...');

  // 1. Initialize local and cloud storage folders
  StorageService.initialize();

  // 2. Connect Database
  await connectDB();

  // 3. Initialize Subscription Lifecycle CRON
  CronService.init();

  // 4. Report Web Push availability + integrations
  console.log(
    PushService.enabled
      ? '🔔 Web Push (VAPID) enabled.'
      : '🔕 Web Push disabled — set VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY in .env to enable.'
  );
  console.log(`🌐 CORS: ${corsOrigins.includes('*') ? 'ALL (*)' : corsOrigins.join(', ')}`);
  console.log(
    `🧩 Integrations — OCR:${config.ocr.enabled ? 'on' : 'off'} · AI vision:${config.ai.provider} · ` +
      `Email:${config.email.enabled ? 'SMTP' : 'log-only'} · Bancard:${config.bancard.enabled ? 'on' : 'off'} · PIX:${config.pix.psp}`
  );

  // 5. Start WhatsApp Bot (Baileys) in non-blocking mode
  whatsappBot.start().catch((err) => {
    console.warn('⚠️ WhatsApp Baileys start encountered notice:', err?.message || err);
  });

  // 6. Listen HTTP
  app.listen(config.port, () => {
    console.log(`\n======================================================`);
    console.log(`🏥 DOORWAY CORTEX BIO-PASS API RUNNING ON PORT ${config.port}`);
    console.log(`🌐 Base URL:      ${config.baseUrl}`);
    console.log(`📖 Swagger Docs:  ${config.baseUrl}/api/docs`);
    console.log(`📱 Public Card:   ${config.frontendUrl}/e/:uuid`);
    console.log(`======================================================\n`);
  });
}

bootstrap().catch((err) => {
  console.error('Fatal bootstrap error:', err);
});
