import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

export const config = {
  env: process.env.NODE_ENV || 'development',
  // The container runs in UTC; every user-facing date/time must be formatted
  // against this IANA zone (Paraguay, UTC-3/-4) instead of the server's own TZ.
  timezone: process.env.APP_TIMEZONE || 'America/Asuncion',
  port: parseInt(process.env.PORT || '4000', 10),
  baseUrl: process.env.BASE_URL || 'http://localhost:4000',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
  publicEmergencyBaseUrl: process.env.PUBLIC_EMERGENCY_BASE_URL || 'http://localhost:5173/e',
  
  jwtSecret: process.env.JWT_SECRET || 'biopass_cortex_super_secure_jwt_secret_2026_key',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',

  otp: {
    ttlMinutes: parseInt(process.env.OTP_TTL_MINUTES || '5', 10),
    maxAttempts: parseInt(process.env.OTP_MAX_ATTEMPTS || '5', 10),
    devEcho: process.env.OTP_DEV_ECHO !== 'false',
  },

  push: {
    vapidPublicKey: process.env.VAPID_PUBLIC_KEY || '',
    vapidPrivateKey: process.env.VAPID_PRIVATE_KEY || '',
    vapidSubject: process.env.VAPID_SUBJECT || 'mailto:soporte@bio-pass.com',
    get enabled() {
      return !!(this.vapidPublicKey && this.vapidPrivateKey);
    },
  },

  paymentWebhookSecret: process.env.PAYMENT_WEBHOOK_SECRET || '',
  whatsappMaxReconnect: parseInt(process.env.WHATSAPP_MAX_RECONNECT || '8', 10),

  cors: {
    // comma-separated allowlist; '*' keeps the permissive default
    origins: (process.env.CORS_ORIGINS || process.env.FRONTEND_URL || '*')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  },

  ocr: {
    enabled: process.env.OCR_ENABLED !== 'false',
    langs: process.env.OCR_LANGS || 'spa+eng',
  },

  ai: {
    // 'openai' | 'gemini' | 'niro' | 'none' (auto-picks based on which key is set when unset)
    visionProvider: (process.env.AI_VISION_PROVIDER || '').toLowerCase(),
    openaiApiKey: process.env.OPENAI_API_KEY || '',
    openaiModel: process.env.OPENAI_VISION_MODEL || 'gpt-4o-mini',
    geminiApiKey: process.env.GEMINI_API_KEY || '',
    geminiModel: process.env.GEMINI_VISION_MODEL || 'gemini-1.5-flash',
    // Niro is our own multimodal gateway (chat + vision). Same key as NiroService.
    niroApiKey: process.env.NIRO_API_KEY || '',
    get provider(): 'openai' | 'gemini' | 'niro' | 'none' {
      if (
        this.visionProvider === 'openai' ||
        this.visionProvider === 'gemini' ||
        this.visionProvider === 'niro' ||
        this.visionProvider === 'none'
      ) {
        return this.visionProvider;
      }
      if (this.openaiApiKey) return 'openai';
      if (this.geminiApiKey) return 'gemini';
      if (this.niroApiKey) return 'niro';
      return 'none';
    },
  },

  email: {
    host: process.env.SMTP_HOST || '',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.EMAIL_FROM || 'Doorway Cortex Bio-Pass <no-reply@bio-pass.com>',
    get enabled() {
      return !!this.host;
    },
  },

  bancard: {
    publicKey: process.env.BANCARD_PUBLIC_KEY || '',
    privateKey: process.env.BANCARD_PRIVATE_KEY || '',
    env: (process.env.BANCARD_ENV || 'staging').toLowerCase(),
    /**
     * Full API + hosted-checkout host. Override with BANCARD_BASE_URL (no trailing slash);
     * otherwise: production → https://vpos.infonet.com.py, staging → https://vpos.infonet.com.py:8888
     */
    get baseUrl() {
      const override = process.env.BANCARD_BASE_URL;
      if (override) return override.replace(/\/+$/, '');
      return this.env === 'production'
        ? 'https://vpos.infonet.com.py'
        : 'https://vpos.infonet.com.py:8888';
    },
    /** Bancard-side confirmation (webhook) URL to register for this commerce — informational, printed on boot. */
    get webhookUrl() {
      return `${config.baseUrl}/api/payments/bancard/webhook`;
    },
    get enabled() {
      return !!(this.publicKey && this.privateKey);
    },
  },

  tigoMoney: {
    apiUrl: process.env.TIGO_MONEY_API_URL || '',
    clientId: process.env.TIGO_MONEY_CLIENT_ID || '',
    clientSecret: process.env.TIGO_MONEY_CLIENT_SECRET || '',
    get enabled() {
      return !!(this.apiUrl && this.clientId && this.clientSecret);
    },
  },

  pix: {
    // 'mercadopago' calls the real PSP; 'manual' emits a static BR Code payload (valid CRC16)
    psp: (process.env.PIX_PSP || 'manual').toLowerCase(),
    mercadopagoToken: process.env.MERCADOPAGO_ACCESS_TOKEN || '',
    merchantName: (process.env.PIX_MERCHANT_NAME || 'DOORWAY CORTEX BIOPASS').toUpperCase(),
    merchantCity: (process.env.PIX_MERCHANT_CITY || 'SAO PAULO').toUpperCase(),
  },

  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID || 'AC_mock',
    authToken: process.env.TWILIO_AUTH_TOKEN || 'mock_token',
    phoneNumber: process.env.TWILIO_PHONE_NUMBER || '+15551234567',
  },
  
  baileys: {
    authDir: path.resolve(process.env.BAILEYS_AUTH_DIR || './auth_info_baileys'),
    botNumber: process.env.WHATSAPP_BOT_NUMBER || '595981000000',
  },
  
  storage: {
    useLocal: process.env.USE_LOCAL_STORAGE !== 'false',
    uploadDir: path.resolve(process.env.UPLOAD_DIR || './uploads'),
    s3Endpoint: process.env.S3_ENDPOINT || 'http://localhost:9000',
    s3Bucket: process.env.S3_BUCKET_NAME || 'biopass-medical-vault',
  },
  
  payments: {
    paraguayAlias: process.env.PARAGUAY_BANK_ALIAS || 'BIOPASS.PY',
    paraguayBank: process.env.PARAGUAY_BANK_NAME || 'Banco Continental',
    paraguayTigoWallet: process.env.PARAGUAY_TIGO_MONEY_WALLET || '0981123456',
    brasilPixKey: process.env.BRASIL_PIX_KEY || 'financeiro@bio-pass.com',
    planPrices: {
      PY: {
        MONTHLY: 35000, // Gs. 35.000 / mes
        ANNUAL: 300000,  // Gs. 300.000 / año
        FINE: 50000,     // Gs. 50.000
      },
      BR: {
        MONTHLY: 25,     // R$ 25 / mes
        ANNUAL: 220,     // R$ 220 / año
        FINE: 44,        // R$ 44
      },
    },
  },
};
