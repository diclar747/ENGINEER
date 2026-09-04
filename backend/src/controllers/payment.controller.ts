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
    res.json({
      paraguay: {
        currency: 'PYG',
        gateway: BancardService.enabled ? 'BANCARD' : 'BANK_TRANSFER',
        plans: {
          monthly: { name: 'Plan Mensual', amount: config.payments.planPrices.PY.MONTHLY, formatted: 'Gs. 35.000' },
          annual: { name: 'Plan Anual', amount: config.payments.planPrices.PY.ANNUAL, formatted: 'Gs. 300.000' },
          fine: { name: 'Multa de Reactivación', amount: config.payments.planPrices.PY.FINE, formatted: 'Gs. 50.000' },
        },
        methods: ['Bancard / Tarjetas / QR', 'SIPAP / Alias Bancario', 'Tigo Money'],
      },
      brasil: {
        currency: 'BRL',
        gateway: config.pix.psp === 'mercadopago' && config.pix.mercadopagoToken ? 'MERCADOPAGO' : 'PIX',
        plans: {
          monthly: { name: 'Plano Mensal', amount: config.payments.planPrices.BR.MONTHLY, formatted: 'R$ 25,00' },
          annual: { name: 'Plano Anual', amount: config.payments.planPrices.BR.ANNUAL, formatted: 'R$ 220,00' },
          fine: { name: 'Multa de Reativação', amount: config.payments.planPrices.BR.FINE, formatted: 'R$ 44,00' },
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

  /** Bancard hits this (GET, browser redirect) after the hosted checkout. We verify then activate. */
  public static async bancardReturn(req: Request, res: Response): Promise<void> {
    const ref = String(req.query.ref || '');
    const order = await prisma.paymentOrder.findUnique({ where: { referenceCode: ref }, include: { subscription: true } });
    const redirectBase = `${config.frontendUrl}/checkout?ref=${ref}`;

    if (!order || !order.gatewayRef) {
      res.redirect(`${redirectBase}&status=error`);
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
      } else {
        res.redirect(`${redirectBase}&status=pending`);
      }
    } catch (err: any) {
      console.error('[bancard:return]', err?.message);
      res.redirect(`${redirectBase}&status=error`);
    }
  }
}
