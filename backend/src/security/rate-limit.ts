import rateLimit from 'express-rate-limit';

const isDev = process.env.NODE_ENV === 'development';

/** Aggressive limiter for credential endpoints (OTP request / login). */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: isDev ? 100 : 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Esperá unos minutos e intentá de nuevo.' },
});

/** Web self-registration is a multi-step wizard (~12 posts), so it needs more
 *  headroom than the login limiter while still bounding abuse. */
export const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: isDev ? 300 : 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Demasiadas peticiones de registro. Esperá unos minutos e intentá de nuevo.' },
});

/** Tight limiter specifically for OTP issuance to prevent WhatsApp spam / cost abuse. */
export const otpRequestLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: isDev ? 50 : 4,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => {
    const body = (req.body || {}) as { phoneNumber?: string };
    const phone = (body.phoneNumber || '').replace(/[^0-9]/g, '');
    return phone ? `otp:${phone}` : `otp:ip:${req.ip}`;
  },
  message: { error: 'Ya pediste varios códigos. Esperá unos minutos antes de solicitar otro.' },
});

/** Moderate limiter for the public emergency card (allow real rescuers, stop scraping). */
export const emergencyLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: isDev ? 500 : 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Límite de consultas alcanzado. Intentá nuevamente en unos minutos.' },
});

/** General API safety net. */
export const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: isDev ? 2000 : 240,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Rate limit excedido.' },
});
