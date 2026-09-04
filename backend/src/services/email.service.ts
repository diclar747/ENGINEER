import nodemailer, { Transporter } from 'nodemailer';
import { prisma } from '../database/prisma';
import { config } from '../config';

export type EmailTemplate = 'invoice' | 'vault_backup' | 'welcome' | 'generic';

interface SendArgs {
  to: string;
  subject: string;
  template: EmailTemplate;
  html: string;
  text?: string;
}

let transporter: Transporter | null = null;
function getTransport(): Transporter | null {
  if (!config.email.enabled) return null;
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host: config.email.host,
    port: config.email.port,
    secure: config.email.secure,
    auth: config.email.user ? { user: config.email.user, pass: config.email.pass } : undefined,
  });
  return transporter;
}

function shell(bodyHtml: string): string {
  return `<!doctype html><html><body style="margin:0;background:#0b1220;padding:24px;font-family:Segoe UI,Roboto,Arial,sans-serif">
  <div style="max-width:560px;margin:0 auto;background:#111827;border:1px solid #1f2937;border-radius:16px;overflow:hidden">
    <div style="background:linear-gradient(135deg,#e11d48,#f59e0b);padding:18px 24px;color:#fff;font-weight:800;letter-spacing:.5px">
      DOORWAY CORTEX · BIO-PASS
    </div>
    <div style="padding:24px;color:#e5e7eb;font-size:14px;line-height:1.6">${bodyHtml}</div>
    <div style="padding:16px 24px;color:#6b7280;font-size:11px;border-top:1px solid #1f2937">
      Doorway Cortex Bio-Pass · Mobile Health Passport · Este es un mensaje automático.
    </div>
  </div></body></html>`;
}

export class EmailService {
  static get enabled(): boolean {
    return config.email.enabled;
  }

  /** Sends (or logs, if SMTP is not configured) and always records an EmailLog row. */
  static async send(args: SendArgs): Promise<{ status: 'SENT' | 'FAILED' | 'LOGGED' }> {
    const t = getTransport();
    if (!t) {
      console.log(`📧 [EMAIL:LOGGED -> ${args.to}] ${args.subject} (SMTP no configurado)`);
      await prisma.emailLog.create({
        data: { to: args.to, subject: args.subject, template: args.template, status: 'LOGGED' },
      });
      return { status: 'LOGGED' };
    }
    try {
      await t.sendMail({
        from: config.email.from,
        to: args.to,
        subject: args.subject,
        text: args.text || args.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
        html: args.html,
      });
      await prisma.emailLog.create({
        data: { to: args.to, subject: args.subject, template: args.template, status: 'SENT' },
      });
      return { status: 'SENT' };
    } catch (err: any) {
      console.error(`📧 [EMAIL:FAILED -> ${args.to}]`, err?.message || err);
      await prisma.emailLog.create({
        data: {
          to: args.to,
          subject: args.subject,
          template: args.template,
          status: 'FAILED',
          error: String(err?.message || err).slice(0, 480),
        },
      });
      return { status: 'FAILED' };
    }
  }

  static sendInvoice(to: string, data: {
    fullName: string;
    plan: string;
    amountFormatted: string;
    referenceCode: string;
    paidAt: Date;
    emergencyUrl: string;
  }) {
    const html = shell(`
      <h2 style="margin:0 0 8px;color:#fff">Pago confirmado ✅</h2>
      <p>Hola ${data.fullName || ''}, recibimos tu pago y tu Bio-Pass está <b>activo</b>.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0">
        <tr><td style="padding:6px 0;color:#9ca3af">Plan</td><td style="text-align:right">${data.plan}</td></tr>
        <tr><td style="padding:6px 0;color:#9ca3af">Monto</td><td style="text-align:right"><b>${data.amountFormatted}</b></td></tr>
        <tr><td style="padding:6px 0;color:#9ca3af">Referencia</td><td style="text-align:right;font-family:monospace">${data.referenceCode}</td></tr>
        <tr><td style="padding:6px 0;color:#9ca3af">Fecha</td><td style="text-align:right">${data.paidAt.toLocaleString('es-PY', { timeZone: config.timezone })}</td></tr>
      </table>
      <p>Tu enlace público de emergencia:<br><a href="${data.emergencyUrl}" style="color:#fb7185">${data.emergencyUrl}</a></p>
      <p style="color:#9ca3af;font-size:12px">Este comprobante sirve como constancia de pago del servicio.</p>
    `);
    return this.send({ to, subject: `Bio-Pass — comprobante de pago ${data.referenceCode}`, template: 'invoice', html });
  }

  static sendVaultBackup(to: string, data: { fullName: string; downloadUrl: string; expiresAt: Date }) {
    const html = shell(`
      <h2 style="margin:0 0 8px;color:#fff">Tu respaldo está listo 📦</h2>
      <p>Hola ${data.fullName || ''}, generaste una exportación completa de tu historial.</p>
      <p style="margin:16px 0">
        <a href="${data.downloadUrl}" style="background:#e11d48;color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:700">
          Descargar archivo cifrado
        </a>
      </p>
      <p style="color:#9ca3af;font-size:12px">
        El archivo ZIP está protegido con tu PIN de 4 dígitos. El enlace vence el ${data.expiresAt.toLocaleString('es-PY', { timeZone: config.timezone })}.
      </p>
    `);
    return this.send({ to, subject: 'Bio-Pass — descarga de tu historial completo', template: 'vault_backup', html });
  }
}
