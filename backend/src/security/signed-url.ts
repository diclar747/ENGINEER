/**
 * URLs firmadas para los archivos de `/uploads`.
 *
 * Hasta ahora `/uploads` se servía con `express.static` sin ningún control: quien
 * tuviera (o adivinara) la URL abría estudios, recetas, fotos de cédula y selfies
 * de recuperación de cualquier titular, sin sesión. Los nombres traen un UUID, así
 * que no se adivinan a lo bruto, pero una URL filtrada —un reenvío de WhatsApp, el
 * historial del navegador, un log de proxy— quedaba abierta para siempre.
 *
 * Ahora cada archivo se entrega con una firma que vence. La API firma la URL en el
 * momento de devolvérsela a alguien que ya demostró tener derecho a verla (el
 * titular con su sesión, el médico que puso el PIN, el admin), y el servidor
 * rechaza cualquier pedido sin firma válida.
 */
import crypto from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { config } from '../config';

/** Ventana por defecto: alcanza para abrir y descargar sin que la URL quede viva. */
export const SIGNED_URL_TTL_SECONDS = 60 * 60; // 1 hora
/** Los exports completos se generan y se bajan más tarde; su propio flujo dice 24 h. */
export const EXPORT_URL_TTL_SECONDS = 24 * 60 * 60;

/**
 * Carpetas que siguen siendo públicas. Solo el logo de la organización, que se
 * muestra en la ficha de emergencia ANTES de cualquier autenticación (la ve quien
 * escanea el QR de alguien accidentado) y no es un dato de salud.
 */
const PUBLIC_FOLDERS = ['logos'];

const secret = (): string => config.jwtSecret;

/** Saca lo accesorio y rechaza el traversal: la firma no debe servir para salir de uploads. */
function clean(rel: string): string | null {
  const c = rel.replace(/^\/+/, '').split('?')[0].split('#')[0];
  if (!c || c.includes('..')) return null;
  return c;
}

/**
 * URL guardada → ruta relativa dentro de uploads. Devuelve null si NO es un archivo
 * nuestro: sin esto se le pegaba una firma a cualquier URL que pasara por acá.
 */
function relativeFromUrl(fileUrl: string): string | null {
  if (!fileUrl) return null;
  const marker = '/uploads/';
  const idx = fileUrl.indexOf(marker);
  if (idx === -1) return null;
  return clean(fileUrl.slice(idx + marker.length));
}

/** Ruta que llega al portero (ya viene sin el prefijo `/uploads`, por el mount). */
function relativeFromRequest(reqPath: string): string | null {
  return clean(reqPath || '');
}

function signature(relPath: string, exp: number): string {
  return crypto.createHmac('sha256', secret()).update(`${relPath}|${exp}`).digest('hex').slice(0, 32);
}

/** Firma para una ruta relativa cualquiera dentro de uploads ("exports/x.zip"). */
export function signPath(relPath: string, ttlSeconds = SIGNED_URL_TTL_SECONDS): { exp: number; sig: string } {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  return { exp, sig: signature(relPath, exp) };
}

/**
 * ¿La firma corresponde a esta ruta y sigue vigente? Se usa tanto en el portero de
 * `/uploads` como en la descarga del export completo, que tiene ruta propia.
 */
export function isValidSignature(relPath: string, expRaw: unknown, sigRaw: unknown): boolean {
  const exp = Number(expRaw);
  const sig = String(sigRaw || '');
  if (!Number.isFinite(exp) || !sig) return false;
  if (exp * 1000 < Date.now()) return false;
  const expected = signature(relPath, exp);
  if (sig.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

/**
 * Agrega firma y vencimiento a una URL de `/uploads`. Devuelve la entrada tal cual
 * si no es un archivo de uploads (una URL externa, o vacío).
 */
export function signUploadUrl(fileUrl: string | null | undefined, ttlSeconds = SIGNED_URL_TTL_SECONDS): string {
  if (!fileUrl) return fileUrl || '';
  const rel = relativeFromUrl(fileUrl);
  if (!rel) return fileUrl;
  if (PUBLIC_FOLDERS.includes(rel.split('/')[0])) return fileUrl;
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sep = fileUrl.includes('?') ? '&' : '?';
  return `${fileUrl}${sep}exp=${exp}&sig=${signature(rel, exp)}`;
}

/** Firma el `fileUrl` de un registro que sale hacia el navegador. */
export function withSignedFileUrl<T extends { fileUrl?: string | null }>(row: T, ttlSeconds?: number): T {
  if (!row?.fileUrl) return row;
  return { ...row, fileUrl: signUploadUrl(row.fileUrl, ttlSeconds) };
}

/** Igual, para una lista. */
export function withSignedFileUrls<T extends { fileUrl?: string | null }>(rows: T[], ttlSeconds?: number): T[] {
  return (rows || []).map((r) => withSignedFileUrl(r, ttlSeconds));
}

/**
 * Portero de `/uploads`. Deja pasar solo lo público y lo que trae una firma vigente.
 * Va montado ANTES de `express.static`.
 */
export function uploadsGuard(req: Request, res: Response, next: NextFunction): void {
  const rel = relativeFromRequest(decodeURIComponent(req.path || ''));
  if (!rel) {
    res.status(400).json({ error: 'Ruta inválida.' });
    return;
  }
  if (PUBLIC_FOLDERS.includes(rel.split('/')[0])) {
    next();
    return;
  }

  if (!isValidSignature(rel, req.query.exp, req.query.sig)) {
    const vencido = Number(req.query.exp) * 1000 < Date.now();
    res.status(403).json({
      error: vencido
        ? 'El enlace venció. Volvé a abrir el archivo desde tu cuenta en Bio-Pass.'
        : 'Este archivo es privado. Abrilo desde tu cuenta en Bio-Pass.',
    });
    return;
  }
  // Un archivo privado nunca debe quedar en una caché compartida.
  res.setHeader('Cache-Control', 'private, max-age=0, no-store');
  next();
}
