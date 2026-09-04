import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';
import { config } from '../config';

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').toLowerCase().trim();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

export interface AdminRequest extends Request {
  admin?: { email: string };
}

export function adminCredentialsOk(email: string, password: string): boolean {
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) return false;
  return email.toLowerCase().trim() === ADMIN_EMAIL && password === ADMIN_PASSWORD;
}

export function generateAdminToken(email: string): string {
  return jwt.sign({ scope: 'admin', email }, config.jwtSecret, { expiresIn: '12h' } as jwt.SignOptions);
}

export function requireAdmin(req: AdminRequest, res: Response, next: NextFunction): void {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) {
    res.status(401).json({ error: 'No autorizado' });
    return;
  }
  try {
    const decoded = jwt.verify(h.split(' ')[1], config.jwtSecret) as { scope?: string; email?: string };
    if (decoded.scope !== 'admin') {
      res.status(403).json({ error: 'Requiere sesion de administrador' });
      return;
    }
    req.admin = { email: decoded.email || '' };
    next();
  } catch {
    res.status(401).json({ error: 'Sesion invalida o expirada' });
  }
}
