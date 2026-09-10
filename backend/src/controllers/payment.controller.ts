import crypto from 'crypto';
import { Request, Response } from 'express';
import { AuthenticatedRequest } from '../security/jwt';
import { PaymentService } from '../services/payment.service';
import { BancardService } from '../services/bancard.service';
import { PixService } from '../services/pix.service';
import { prisma } from '../database/prisma';
import { config } from '../config';

/** Todos los shop_process_id de una orden Bancard (lista + gatewayRef actual), sin repetir. */
function bancardIds(order: { gatewayRef: string | null; bancardProcessIds: string | null }): string[] {
  const set = new Set<string>();
  if (order.gatewayRef) set.add(order.gatewayRef);
  try {
    const arr = order.bancardProcessIds ? JSON.parse(order.bancardProcessIds) : [];
    if (Array.isArray(arr)) arr.forEach((x) => x && set.add(String(x)));
  } catch {
    /* noop */
  }
  return [...set];
}

/** Consulta la confirmación de cada shop_process_id; true si alguno está aprobado. */
async function bancardConfirmAny(ids: string[]): Promise<boolean> {
  for (const id of ids) {
    try {
      const { approved } = await BancardService.confirm({ shopProcessId: id });
      if (approved) return true;
    } catch {
      /* PaymentNotFoundError / WAF: seguimos con el siguiente */
    }
  }
  return false;
}

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
        where: {
          gateway: 'BANCARD',
          OR: [{ gatewayRef: shopProcessId }, { bancardProcessIds: { contains: shopProcessId } }],
        },
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

    if (!order) {
      res.redirect(`${redirectBase}&status=error`);
      return;
    }
    if (order.status === 'PAID') {
      res.redirect(`${redirectBase}&status=success`);
      return;
    }
    // Consultamos la confirmación de TODOS los shop_process_id que se generaron para esta orden
    // (el /checkout regenera la sesión cuando el process_id vence; solo uno queda pagado).
    const approved = await bancardConfirmAny(bancardIds(order));
    if (approved) {
      await PaymentService.handlePaymentSuccess(order.referenceCode);
      res.redirect(`${redirectBase}&status=success`);
      return;
    }
    // Sin confirmación todavía: NO es un error. La página /checkout sigue consultando y el
    // webhook (si está registrado) también lo activará.
    res.redirect(`${redirectBase}&status=pending`);
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

    // ¿Algún intento anterior ya está pagado? (auto-activa /checkout al volver, sin webhook).
    const prevIds = bancardIds(order);
    if (prevIds.length && (await bancardConfirmAny(prevIds))) {
      await PaymentService.handlePaymentSuccess(order.referenceCode);
      res.json({ status: 'PAID' });
      return;
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
      // Nada de QR / link directo: `checkout.redirectUrl` (`/checkout/new/<id>`)
      // da 404 en Bancard. El `process_id` sólo sirve para montar el form con el
      // SDK `bancard-checkout-4.0.0.js` dentro de esta misma página /checkout.
      // Se AGREGA el nuevo shop_process_id a la lista (no se pisan los anteriores) para poder
      // consultar la confirmación de todos.
      const ids = [...new Set([...prevIds, shopProcessId])].slice(-8);
      await prisma.paymentOrder.update({
        where: { id: order.id },
        data: {
          gatewayRef: shopProcessId,
          bancardProcessIds: JSON.stringify(ids),
          paymentLink: checkout.redirectUrl,
          pixQrImage: null,
        },
      });
      res.json({
        processId: checkout.processId,
        bancardBaseUrl: config.bancard.baseUrl,
      });
    } catch (e: any) {
      console.error('[bancard:session]', e?.message);
      res.status(502).json({ error: 'No se pudo iniciar el pago con Bancard.' });
    }
  }
}
