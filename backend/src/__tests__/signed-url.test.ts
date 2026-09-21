import { describe, expect, it, vi } from 'vitest';
import {
  isValidSignature,
  signPath,
  signUploadUrl,
  uploadsGuard,
  withSignedFileUrls,
} from '../security/signed-url';

const BASE = 'https://api.bio-pass.cnid.com.py';
const STUDY = `${BASE}/uploads/medical_studies/study_abc_123.pdf`;

/** Express-like mínimo para ejercitar el portero sin levantar el servidor. */
function runGuard(path: string, query: Record<string, unknown>) {
  const res: any = {
    statusCode: 0,
    body: null as any,
    headers: {} as Record<string, string>,
    status(c: number) { this.statusCode = c; return this; },
    json(b: unknown) { this.body = b; return this; },
    setHeader(k: string, v: string) { this.headers[k] = v; },
  };
  const next = vi.fn();
  uploadsGuard({ path, query } as any, res, next);
  return { res, passed: next.mock.calls.length > 0 };
}

/** Saca exp/sig de una URL ya firmada. */
function parts(url: string) {
  const q = new URLSearchParams(url.split('?')[1] || '');
  return { exp: q.get('exp'), sig: q.get('sig') };
}

describe('signUploadUrl', () => {
  it('firma los archivos privados y deja pasar el resultado por el portero', () => {
    const signed = signUploadUrl(STUDY);
    expect(signed).not.toBe(STUDY);
    const { exp, sig } = parts(signed);
    expect(runGuard('/medical_studies/study_abc_123.pdf', { exp, sig }).passed).toBe(true);
  });

  it('los logos de organización siguen siendo públicos (se ven antes de cualquier login)', () => {
    const logo = `${BASE}/uploads/logos/org.png`;
    expect(signUploadUrl(logo)).toBe(logo);
    expect(runGuard('/logos/org.png', {}).passed).toBe(true);
  });

  it('no toca lo que no es un archivo de uploads', () => {
    expect(signUploadUrl('')).toBe('');
    expect(signUploadUrl(null)).toBe('');
    expect(signUploadUrl('https://otro.sitio/x.pdf')).toBe('https://otro.sitio/x.pdf');
  });

  it('firma una lista entera de estudios', () => {
    const rows = [{ id: '1', fileUrl: STUDY }, { id: '2', fileUrl: null }];
    const out = withSignedFileUrls(rows as any);
    expect(out[0].fileUrl).toContain('sig=');
    expect(out[1].fileUrl).toBeNull();
  });
});

describe('uploadsGuard — lo que debe RECHAZAR', () => {
  it('sin firma: es exactamente el agujero que había antes', () => {
    const r = runGuard('/medical_studies/study_abc_123.pdf', {});
    expect(r.passed).toBe(false);
    expect(r.res.statusCode).toBe(403);
  });

  it('firma de OTRO archivo no sirve para este', () => {
    const { exp, sig } = parts(signUploadUrl(STUDY));
    const r = runGuard('/medical_studies/study_de_otra_persona.pdf', { exp, sig });
    expect(r.passed).toBe(false);
    expect(r.res.statusCode).toBe(403);
  });

  it('firma vencida', () => {
    const { exp, sig } = parts(signUploadUrl(STUDY, -10));
    const r = runGuard('/medical_studies/study_abc_123.pdf', { exp, sig });
    expect(r.passed).toBe(false);
    expect(r.res.statusCode).toBe(403);
    expect(String(r.res.body.error)).toContain('venció');
  });

  it('no se puede estirar el vencimiento sin la clave', () => {
    const { sig } = parts(signUploadUrl(STUDY));
    const futuro = Math.floor(Date.now() / 1000) + 99999;
    expect(runGuard('/medical_studies/study_abc_123.pdf', { exp: futuro, sig }).passed).toBe(false);
  });

  it('firma inventada, del largo correcto', () => {
    const { exp } = parts(signUploadUrl(STUDY));
    const r = runGuard('/medical_studies/study_abc_123.pdf', { exp, sig: 'a'.repeat(32) });
    expect(r.passed).toBe(false);
  });

  it('path traversal', () => {
    const r = runGuard('/../../etc/passwd', { exp: 1, sig: 'x' });
    expect(r.passed).toBe(false);
    expect(r.res.statusCode).toBe(400);
  });

  it('cédulas y selfies de recuperación tampoco son públicas', () => {
    expect(runGuard('/ci_documents/ci_x.jpg', {}).passed).toBe(false);
    expect(runGuard('/recovery_selfies/s_x.jpg', {}).passed).toBe(false);
    expect(runGuard('/exports/backup.zip', {}).passed).toBe(false);
    expect(runGuard('/qr_stickers/sticker_x.pdf', {}).passed).toBe(false);
  });

  it('un archivo privado no queda en cachés compartidas', () => {
    const { exp, sig } = parts(signUploadUrl(STUDY));
    const r = runGuard('/medical_studies/study_abc_123.pdf', { exp, sig });
    expect(r.res.headers['Cache-Control']).toContain('no-store');
  });
});

describe('signPath / isValidSignature — descarga del export completo', () => {
  it('acepta la suya y rechaza la de otro archivo', () => {
    const { exp, sig } = signPath('exports/backup_juan.zip', 60);
    expect(isValidSignature('exports/backup_juan.zip', exp, sig)).toBe(true);
    expect(isValidSignature('exports/backup_otro.zip', exp, sig)).toBe(false);
  });

  it('rechaza faltantes, basura y vencidas', () => {
    expect(isValidSignature('exports/x.zip', undefined, undefined)).toBe(false);
    expect(isValidSignature('exports/x.zip', 'abc', 'def')).toBe(false);
    const viejo = signPath('exports/x.zip', -1);
    expect(isValidSignature('exports/x.zip', viejo.exp, viejo.sig)).toBe(false);
  });
});
