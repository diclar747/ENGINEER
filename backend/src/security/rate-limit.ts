import rateLimit from 'express-rate-limit';
import type { Request } from 'express';

const isDev = process.env.NODE_ENV === 'development';

/**
 * Cliente real detrás de Cloudflare → Traefik → nginx → backend. Con
 * `trust proxy = 1`, `req.ip` resuelve la IP interna de Traefik (10.x) para
 * TODOS los visitantes, así que cada límite era uno solo compartido por toda la
 * plataforma (10 logins cada 15 min para todo el mundo). Cloudflare siempre
 * manda `CF-Connecting-IP` con la IP del visitante.
 */
export function clientIp(req: Request): string {
  const cf = req.headers['cf-connecting-ip'];
  if (typeof cf === 'string' && cf.trim()) return cf.trim();
  return req.ip || req.socket.remoteAddress || 'unknown';
}

/** Aggressive limiter for credential endpoints (OTP request / login). */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: isDev ? 100 : 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => `auth:${clientIp(req)}`,
  message: { error: 'Demasiados intentos. Esperá unos minutos e intentá de nuevo.' },
});

/** Web self-registration is a multi-step wizard (~12 posts), so it needs more
 *  headroom than the login limiter while still bounding abuse. */
export const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: isDev ? 300 : 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => `reg:${clientIp(req)}`,
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
    return phone ? `otp:${phone}` : `otp:ip:${clientIp(req)}`;
  },
  message: { error: 'Ya pediste varios códigos. Esperá unos minutos antes de solicitar otro.' },
});

/** Moderate limiter for the public emergency card (allow real rescuers, stop scraping). */
export const emergencyLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: isDev ? 500 : 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => `emg:${clientIp(req)}`,
  message: { error: 'Límite de consultas alcanzado. Intentá nuevamente en unos minutos.' },
});

/** General API safety net. */
export const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: isDev ? 2000 : 240,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => `g:${clientIp(req)}`,
  message: { error: 'Rate limit excedido.' },
});
