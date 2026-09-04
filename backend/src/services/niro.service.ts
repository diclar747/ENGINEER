import axios from 'axios';
import http2 from 'http2';

const BASE = (process.env.NIRO_BASE_URL || 'https://niro.cnid.com.py').replace(/\/$/, '');
const KEY = process.env.NIRO_API_KEY || '';

export interface ChatMsg { role: 'system' | 'user' | 'assistant'; content: string; }

/**
 * Builds a multipart/form-data body by hand (Buffer), with a matching Content-Type
 * header carrying the boundary. Used instead of the `form-data` npm package because
 * we need the exact byte length up-front for the HTTP/2 request below.
 */
function buildMultipart(
  fields: { name: string; value: string | Buffer; filename?: string; contentType?: string }[],
): { body: Buffer; contentType: string } {
  const boundary = `----niroBoundary${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`;
  const parts: Buffer[] = [];
  for (const f of fields) {
    let header = `--${boundary}\r\nContent-Disposition: form-data; name="${f.name}"`;
    if (f.filename) header += `; filename="${f.filename}"`;
    header += '\r\n';
    if (f.contentType) header += `Content-Type: ${f.contentType}\r\n`;
    header += '\r\n';
    parts.push(Buffer.from(header, 'utf8'));
    parts.push(typeof f.value === 'string' ? Buffer.from(f.value, 'utf8') : f.value);
    parts.push(Buffer.from('\r\n', 'utf8'));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

/**
 * Niro's vision endpoint sits behind an origin that only replies correctly over
 * HTTP/2 — the exact same multipart body over HTTP/1.1 (which is all axios/Node's
 * `http`/`https` modules speak) gets a Cloudflare 502 "origin overloaded" every
 * time, confirmed by reproducing it both via axios and via `curl --http1.1`, while
 * `curl --http2` with the identical payload succeeds. So this one call is made with
 * Node's core `http2` module directly instead of axios.
 */
function postMultipartHttp2(
  path: string,
  headers: Record<string, string>,
  body: Buffer,
  timeoutMs: number,
): Promise<{ status: number; json: any }> {
  return new Promise((resolve, reject) => {
    const client = http2.connect(BASE);
    const timer = setTimeout(() => {
      client.close();
      reject(new Error('timeout'));
    }, timeoutMs);
    client.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    const req = client.request({
      ':method': 'POST',
      ':path': path,
      'content-length': String(body.length),
      ...headers,
    });

    let status = 0;
    let raw = '';
    req.on('response', (h) => {
      status = Number(h[':status']) || 0;
    });
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      clearTimeout(timer);
      client.close();
      try {
        resolve({ status, json: raw ? JSON.parse(raw) : null });
      } catch {
        resolve({ status, json: null });
      }
    });
    req.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    req.end(body);
  });
}

export class NiroService {
  static get enabled(): boolean {
    return !!KEY;
  }

  /** Chat estilo OpenAI vía Niro. Devuelve el texto del asistente, o null si falla. */
  static async chat(messages: ChatMsg[]): Promise<string | null> {
    if (!KEY) return null;
    try {
      const { data } = await axios.post(
        `${BASE}/api/v1/chat/completions`,
        { model: 'cnid-auto', messages },
        { headers: { Authorization: `Bearer ${KEY}` }, timeout: 25000 },
      );
      const text = data?.choices?.[0]?.message?.content;
      return typeof text === 'string' && text.trim() ? text.trim() : null;
    } catch (err: any) {
      console.warn('[NIRO] chat error:', err?.response?.status, err?.response?.data?.error?.message || err?.message);
      return null;
    }
  }

  /**
   * OCR / extracción con visión vía Niro.
   * mode: 'text' = OCR plano · 'invoice' = JSON estructurado de factura PY
   */
  static async visionExtract(
    file: Buffer,
    filename = 'archivo.jpg',
    opts: { mode?: 'text' | 'invoice'; question?: string } = {},
  ): Promise<{ text: string; data?: any } | null> {
    if (!KEY) return null;
    try {
      const { body, contentType } = buildMultipart([
        { name: 'file', value: file, filename, contentType: guessMime(filename) },
        ...(opts.mode ? [{ name: 'mode', value: opts.mode }] : []),
        ...(opts.question ? [{ name: 'question', value: opts.question }] : []),
      ]);

      const { status, json } = await postMultipartHttp2(
        '/api/v1/vision/extract',
        { 'content-type': contentType, authorization: `Bearer ${KEY}` },
        body,
        45000,
      );

      if (status < 200 || status >= 300) {
        console.warn('[NIRO] vision error:', status, json?.error?.message || json?.detail);
        return null;
      }
      return { text: json?.text || '', data: json?.data };
    } catch (err: any) {
      console.warn('[NIRO] vision error:', err?.message);
      return null;
    }
  }
}

function guessMime(filename: string): string {
  const ext = filename.toLowerCase().split('.').pop() || '';
  if (ext === 'png') return 'image/png';
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'webp') return 'image/webp';
  return 'image/jpeg';
}
