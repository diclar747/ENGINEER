import crypto from 'crypto';
import { Request, Response } from 'express';
import { AuthenticatedRequest } from '../security/jwt';
import { PaymentService } from '../services/payment.service';
import { BancardService } from '../services/bancard.service';
import { PixService } from '../services/pix.service';
import { prisma } from '../database/prisma';
import { config } from '../config';

/** Constant-time comparison of the webhook shared secret. */
function webhookSecretValid(req: Request): boolean {
  const expected = config.paymentWebhookSecret;
  if (!expected) return config.env === 'development';
  const provided = String(req.headers['x-webhook-secret'] || '');
  if (provided.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

export class PaymentController {
  public static async createOrder(req: AuthenticatedRequest, res: Response): Promise<void> {
    const userId = req.user?.userId || req.body.userId;
    const { plan, country, isFine } = req.body;
    if (!userId || !plan || !country) {
      res.status(400).json({ error: 'Faltan parámetros requeridos (userId, plan, country)' });
      return;
    }
    try {
      const order = await PaymentService.createPaymentOrder({ userId, plan, country, isFine });
      res.json(order);
    } catch (err: any) {
      res.status(500).json({ error: 'Error generando orden de pago', details: err.message });
    }
  }

  /** Public order view for the in-app /checkout page. */
  public static async getOrder(req: Request, res: Response): Promise<void> {
    const order = await PaymentService.getOrderPublic(req.params.ref);
    if (!order) {
      res.status(404).json({ error: 'Orden no encontrada' });
      return;
    }
    res.json(order);
  }

  public static async getPaymentMethods(_req: Request, res: Response): Promise<void> {
    const p = await PaymentService.getPlanPrices();
    const gs = (n: number) => `Gs. ${n.toLocaleString('es-PY')}`;
    const rs = (n: number) => `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
    res.json({
      paraguay: {
        currency: 'PYG',
        gateway: BancardService.enabled ? 'BANCARD' : 'BANK_TRANSFER',
        plans: {
          monthly: { name: 'Plan Mensual', amount: p.PY.MONTHLY, formatted: gs(p.PY.MONTHLY) },
          annual: { name: 'Plan Anual', amount: p.PY.ANNUAL, formatted: gs(p.PY.ANNUAL) },
          fine: { name: 'Multa de Reactivación', amount: p.PY.FINE, formatted: gs(p.PY.FINE) },
        },
        methods: ['Bancard / Tarjetas / QR', 'SIPAP / Alias Bancario', 'Tigo Money'],
      },
      brasil: {
        currency: 'BRL',
        gateway: config.pix.psp === 'mercadopago' && config.pix.mercadopagoToken ? 'MERCADOPAGO' : 'PIX',
        plans: {
          monthly: { name: 'Plano Mensal', amount: p.BR.MONTHLY, formatted: rs(p.BR.MONTHLY) },
          annual: { name: 'Plano Anual', amount: p.BR.ANNUAL, formatted: rs(p.BR.ANNUAL) },
          fine: { name: 'Multa de Reativação', amount: p.BR.FINE, formatted: rs(p.BR.FINE) },
        },
        methods: ['PIX Instantâneo', 'Cartão de Crédito / Débito'],
      },
    });
  }

  /**
   * Generic webhook — accepts either { referenceCode } (with X-Webhook-Secret) or a
   * Mercado Pago notification { type:'payment', data:{ id } } which is verified via the API.
   */
  public static async webhook(req: Request, res: Response): Promise<void> {
    // Mercado Pago style notification
    const mpId = req.body?.data?.id || req.query?.['data.id'];
    if ((req.body?.type === 'payment' || req.query?.type === 'payment') && mpId) {
      try {
        const { approved, externalRef } = await PixService.isMercadoPagoApproved(String(mpId));
        if (approved && externalRef) {
          const order = await prisma.paymentOrder.findFirst({ where: { referenceCode: { contains: externalRef } } });
          if (order) await PaymentService.handlePaymentSuccess(order.referenceCode);
        }
        res.json({ received: true, approved });
      } catch (err: any) {
        res.status(200).json({ received: true, error: err.message }); // 200 so MP doesn't retry-storm
      }
      return;
    }

    // Internal / gateway-agnostic confirmation
    if (!webhookSecretValid(req)) {
      res.status(401).json({ error: 'Webhook no autorizado (X-Webhook-Secret inválido)' });
      return;
    }
    const { referenceCode } = req.body;
    if (!referenceCode) {
      res.status(400).json({ error: 'Reference code required' });
      return;
    }
    const ok = await PaymentService.handlePaymentSuccess(referenceCode);
    if (!ok) {
      res.status(404).json({ error: 'Orden no encontrada o ya procesada' });
      return;
    }
    res.json({ success: true, message: 'Pago acreditado y Bio-Pass activado' });
  }

  /** DEV ONLY — mark an order paid without a real gateway (used by the /checkout "simulate" button). */
  public static async devConfirm(req: Request, res: Response): Promise<void> {
    if (config.env !== 'development') {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    const ok = await PaymentService.handlePaymentSuccess(req.params.ref);
    res.status(ok ? 200 : 404).json(
      ok ? { success: true, message: 'Pago simulado — Bio-Pass activado' } : { error: 'Orden no encontrada o ya pagada' }
    );
  }

  /**
   * Bancard server-to-server confirmation (POST). No X-Webhook-Secret: authenticity is the
   * MD5 token in the payload (privateKey + shop_process_id + "confirm" + amount + currency).
   * Always answers 200 so Bancard doesn't retry-storm. Mirrors cardnet/backend/index.php.
   */
  public static async bancardWebhook(req: Request, res: Response): Promise<void> {
    const op = req.body?.operation;
    const shopProcessId = op?.shop_process_id != null ? String(op.shop_process_id) : '';
    try {
      if (!shopProcessId) {
        res.status(200).json({ status: 'error', message: 'Payload inválido' });
        return;
      }
      const order = await prisma.paymentOrder.findFirst({
        where: { gateway: 'BANCARD', gatewayRef: shopProcessId },
      });
      if (!order) {
        console.warn('[bancard:webhook] orden no encontrada para shop_process_id', shopProcessId);
        res.status(200).json({ status: 'error', message: 'Orden no encontrada' });
        return;
      }

      const currency: 'PYG' | 'USD' = order.currency === 'USD' ? 'USD' : 'PYG';
      const { valid, approved, description } = BancardService.parseWebhook(req.body, {
        amount: order.amount,
        currency,
      });

      if (!valid) {
        console.warn('[bancard:webhook] token inválido para', shopProcessId);
        res.status(200).json({ status: 'error', message: 'Token inválido' });
        return;
      }

      if (approved) {
        await PaymentService.handlePaymentSuccess(order.referenceCode);
        console.log(`[bancard:webhook] pago ${shopProcessId} aprobado — Bio-Pass activado`);
      } else if (order.status !== 'PAID') {
        await prisma.paymentOrder
          .update({ where: { id: order.id }, data: { status: 'FAILED' } })
          .catch(() => {});
        console.log(`[bancard:webhook] pago ${shopProcessId} rechazado: ${description || 'sin detalle'}`);
      }

      res.status(200).json({ status: 'success' });
    } catch (err: any) {
      console.error('[bancard:webhook]', err?.message);
      res.status(200).json({ status: 'error_handled' });
    }
  }

  /** Bancard hits this (GET, browser redirect) after the hosted checkout. We verify then activate. */
  public static async bancardReturn(req: Request, res: Response): Promise<void> {
    const ref = String(req.query.ref || '');
    const order = await prisma.paymentOrder.findUnique({ where: { referenceCode: ref }, include: { subscription: true } });
    const redirectBase = `${config.frontendUrl}/checkout?ref=${ref}`;

    if (!order || !order.gatewayRef) {
      res.redirect(`${redirectBase}&status=error`);
      return;
    }
    // Si ya lo confirmó el webhook, listo.
    if (order.status === 'PAID') {
      res.redirect(`${redirectBase}&status=success`);
      return;
    }
    try {
      const { approved } = await BancardService.confirm({
        shopProcessId: order.gatewayRef,
        amount: order.amount,
        currency: 'PYG',
      });
      if (approved) {
        await PaymentService.handlePaymentSuccess(order.referenceCode);
        res.redirect(`${redirectBase}&status=success`);
        return;
      }
      // No aprobado (o la API de confirmación no está disponible): NO es un error del pago.
      // El webhook es la vía autoritativa; la página /checkout sigue consultando el estado.
      res.redirect(`${redirectBase}&status=pending`);
    } catch (err: any) {
      // 403 = el WAF de Bancard bloquea la consulta server-to-server. El pago pudo salir bien;
      // que lo confirme el webhook. Nunca mostrar "error" solo por esto.
      console.warn('[bancard:return] no se pudo verificar (probable WAF):', err?.message);
      res.redirect(`${redirectBase}&status=pending`);
    }
  }

  /**
   * Genera una sesión FRESCA de Bancard para una orden pendiente. El process_id de Bancard
   * vence a los pocos minutos, así que la página /checkout llama a esto al abrirse en vez de
   * usar el que se creó al generar la orden. Devuelve process_id + URL + QR nuevos.
   */
  public static async bancardSession(req: Request, res: Response): Promise<void> {
    const ref = String(req.params.ref || '');
    const order = await prisma.paymentOrder.findUnique({ where: { referenceCode: ref } });
    if (!order || order.gateway !== 'BANCARD') { res.status(404).json({ error: 'Orden no encontrada.' }); return; }
    if (order.status === 'PAID') { res.json({ status: 'PAID' }); return; }
    if (!BancardService.enabled) { res.status(400).json({ error: 'Bancard no está configurado.' }); return; }

    // Antes de generar una sesión nueva: ¿el pago del intento anterior ya está aprobado?
    // (permite que /checkout se auto-active al volver, sin depender del webhook).
    if (order.gatewayRef) {
      try {
        const { approved } = await BancardService.confirm({ shopProcessId: order.gatewayRef });
        if (approved) {
          await PaymentService.handlePaymentSuccess(order.referenceCode);
          res.json({ status: 'PAID' });
          return;
        }
      } catch (e: any) {
        console.warn('[bancard:session] confirm previo falló:', e?.response?.status || e?.message);
      }
    }

    try {
      const shopProcessId = Date.now().toString();
      const checkout = await BancardService.createCheckout({
        shopProcessId,
        amount: order.amount,
        currency: 'PYG',
        description: `Bio-Pass ${ref.slice(-6)}`,
        returnUrl: `${config.baseUrl}/api/payments/bancard/return?ref=${encodeURIComponent(ref)}`,
        cancelUrl: `${config.frontendUrl}/checkout?ref=${encodeURIComponent(ref)}&status=cancel`,
      });
      const QRCode = (await import('qrcode')).default;
      const qr = await QRCode.toDataURL(checkout.redirectUrl, { errorCorrectionLevel: 'M', margin: 1, width: 320 }).catch(() => null);
      // El webhook y el return buscan la orden por gatewayRef = NUESTRO shop_process_id.
      await prisma.paymentOrder.update({
        where: { id: order.id },
        data: { gatewayRef: shopProcessId, paymentLink: checkout.redirectUrl, pixQrImage: qr },
      });
      res.json({
        processId: checkout.processId,
        redirectUrl: checkout.redirectUrl,
        qr,
        bancardBaseUrl: config.bancard.baseUrl,
      });
    } catch (e: any) {
      console.error('[bancard:session]', e?.message);
      res.status(502).json({ error: 'No se pudo iniciar el pago con Bancard.' });
    }
  }
}
