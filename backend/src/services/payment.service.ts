import { prisma } from '../database/prisma';
import { config } from '../config';
import { QrPdfService } from './qr-pdf.service';
import { whatsappBot } from '../whatsapp/baileys.client';
import { PushService } from './push.service';
import { EmailService } from './email.service';
import { PixService } from './pix.service';
import { BancardService } from './bancard.service';
import QRCode from 'qrcode';

export interface CreateOrderParams {
  userId: string;
  plan: 'MONTHLY' | 'ANNUAL';
  country: 'PARAGUAY' | 'BRASIL';
  paymentMethod?: string;
  isFine?: boolean;
}

interface PlanPriceTable {
  PY: { MONTHLY: number; ANNUAL: number; FINE: number };
  BR: { MONTHLY: number; ANNUAL: number; FINE: number };
}

export class PaymentService {
  /**
   * Precios de los planes. Se leen de AppSetting (editables desde /admin → Contenido),
   * con fallback a config.payments.planPrices (env). Claves: price.py.monthly, price.py.annual,
   * price.py.fine, price.br.monthly, price.br.annual, price.br.fine.
   */
  public static async getPlanPrices(): Promise<PlanPriceTable> {
    const def = config.payments.planPrices;
    try {
      const rows = await prisma.appSetting.findMany({ where: { key: { startsWith: 'price.' } } });
      const s = Object.fromEntries(rows.map((r) => [r.key, r.value]));
      const num = (k: string, fb: number) => {
        const n = Number(String(s[k] ?? '').replace(/[^\d.]/g, ''));
        return Number.isFinite(n) && n > 0 ? n : fb;
      };
      return {
        PY: {
          MONTHLY: num('price.py.monthly', def.PY.MONTHLY),
          ANNUAL: num('price.py.annual', def.PY.ANNUAL),
          FINE: num('price.py.fine', def.PY.FINE),
        },
        BR: {
          MONTHLY: num('price.br.monthly', def.BR.MONTHLY),
          ANNUAL: num('price.br.annual', def.BR.ANNUAL),
          FINE: num('price.br.fine', def.BR.FINE),
        },
      };
    } catch {
      return { PY: { ...def.PY }, BR: { ...def.BR } };
    }
  }

  /**
   * Creates a payment order for Paraguay or Brasil.
   * - PY: Bancard vPOS hosted checkout when configured, plus alias/transfer instructions as fallback.
   * - BR: real Pix BR Code (valid CRC16) or Mercado Pago Pix charge.
   * The `paymentLink` always points to the in-app /checkout page, which renders the right method.
   */
  public static async createPaymentOrder(params: CreateOrderParams) {
    const user = await prisma.user.findUnique({
      where: { id: params.userId },
      include: { organization: true },
    });
    if (!user) throw new Error('User not found');

    const isPY = params.country === 'PARAGUAY';
    const currency = isPY ? 'PYG' : 'BRL';
    // Precios editables desde el panel admin (AppSetting price.*), con fallback al config/env.
    const prices = await PaymentService.getPlanPrices();
    const P = isPY ? prices.PY : prices.BR;
    let baseAmount = params.plan === 'ANNUAL' ? P.ANNUAL : P.MONTHLY;
    if (params.isFine) baseAmount += P.FINE;

    const shopProcessId = Date.now().toString();
    const referenceCode = `BIO-${shopProcessId}-${Math.floor(1000 + Math.random() * 9000)}`;

    const expiryDays = params.plan === 'ANNUAL' ? 365 : 30;
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + expiryDays);

    const subscription = await prisma.subscription.create({
      data: {
        userId: user.id,
        plan: params.plan,
        country: isPY ? 'PARAGUAY' : 'BRASIL',
        currency,
        amount: baseAmount,
        status: 'PENDING_PAYMENT',
        expiryDate,
        finePending: !!params.isFine,
        fineAmount: params.isFine ? P.FINE : 0,
      },
    });

    const checkoutLink = `${config.frontendUrl}/checkout?ref=${referenceCode}`;
    let aliasInfo: string | undefined;
    let pixPayload: string | undefined;
    let pixQrImage: string | undefined;
    let gatewayRef: string | undefined;
    let gateway: 'MERCADOPAGO' | 'PIX' | 'BANCARD' | 'BANK_TRANSFER' = isPY ? 'BANK_TRANSFER' : 'PIX';
    let paymentMethod = isPY ? 'ALIAS / TRANSFERENCIA' : 'PIX';
    let externalRedirect: string | undefined;
    let orderExpiry: Date | undefined;

    if (isPY) {
      // Secondary/manual instructions, shown alongside the Bancard checkout.
      aliasInfo =
        `BANCO: ${config.payments.paraguayBank}\n` +
        `ALIAS SIPAP: ${config.payments.paraguayAlias}\n` +
        `BILLETERA TIGO MONEY: ${config.payments.paraguayTigoWallet}\n` +
        `TITULAR: DOORWAY CORTEX BIO-PASS PY\n` +
        `REF: ${referenceCode}`;

      // Bancard vPOS es el procesador de Paraguay (reemplaza el portal winsap.com.py). El cliente
      // paga con tarjeta o QR en la pantalla alojada de Bancard; el webhook activa la cuenta.
      if (BancardService.enabled) {
        // Un fallo acá sale como error 500 al llamador, en vez de crear silenciosamente una orden
        // "solo transferencia".
        const checkout = await BancardService.createCheckout({
          shopProcessId,
          amount: baseAmount,
          currency: 'PYG',
          description: `Bio-Pass ${params.plan}`,
          returnUrl: `${config.baseUrl}/api/payments/bancard/return?ref=${referenceCode}`,
          cancelUrl: `${checkoutLink}&status=cancel`,
        });
        gateway = 'BANCARD';
        paymentMethod = 'Tarjeta / QR (Bancard)';
        // Guardamos NUESTRO shop_process_id: es lo que Bancard reenvía en el webhook / la
        // confirmación, y por lo que bancardReturn / bancardWebhook buscan la orden. El process_id
        // propio de Bancard no se necesita del lado servidor (vive en externalRedirect).
        gatewayRef = shopProcessId;
        externalRedirect = checkout.redirectUrl;
        // QR escaneable del checkout de Bancard, para mandarlo directo en el chat de WhatsApp.
        try {
          pixQrImage = await QRCode.toDataURL(checkout.redirectUrl, { errorCorrectionLevel: 'M', margin: 1, width: 320 });
        } catch (err: any) {
          console.warn('[payment] Bancard QR render failed:', err?.message);
        }
      } else {
        console.warn(
          '[payment] BANCARD_PUBLIC_KEY / BANCARD_PRIVATE_KEY sin configurar — la orden PY sale solo con instrucciones de transferencia manual.'
        );
      }
    } else {
      const pix = await PixService.createCharge({
        amountBRL: baseAmount,
        txid: referenceCode.replace(/[^A-Za-z0-9]/g, '').slice(0, 25),
        description: `Bio-Pass ${params.plan}`,
        payerEmail: user.email || undefined,
      });
      pixPayload = pix.payload;
      pixQrImage = pix.qrImage;
      gatewayRef = pix.gatewayRef;
      gateway = pix.provider === 'mercadopago' ? 'MERCADOPAGO' : 'PIX';
      paymentMethod = pix.provider === 'mercadopago' ? 'PIX (Mercado Pago)' : 'PIX';
      orderExpiry = pix.expiresAt;
    }

    const paymentOrder = await prisma.paymentOrder.create({
      data: {
        userId: user.id,
        subscriptionId: subscription.id,
        gateway,
        paymentMethod,
        referenceCode,
        amount: baseAmount,
        currency,
        status: 'PENDING',
        aliasInfo,
        pixPayload,
        pixQrImage,
        gatewayRef,
        bancardProcessIds: gateway === 'BANCARD' ? JSON.stringify([shopProcessId]) : null,
        paymentLink: externalRedirect || checkoutLink,
        expiresAt: orderExpiry,
      },
    });

    return {
      orderId: paymentOrder.id,
      referenceCode,
      amount: baseAmount,
      currency,
      formattedAmount: isPY ? `Gs. ${baseAmount.toLocaleString('es-PY')}` : `R$ ${baseAmount.toFixed(2)}`,
      plan: params.plan,
      country: isPY ? 'PARAGUAY' : 'BRASIL',
      gateway,
      paymentMethod,
      checkoutUrl: checkoutLink,
      // El punto de entrada para el usuario es siempre nuestra página /checkout: muestra monto +
      // estado, hace polling de la confirmación y ofrece el botón "Pagar con Bancard".
      paymentLink: checkoutLink,
      externalRedirect,
      aliasInfo,
      pixPayload,
      pixQrImage,
      pixKey: config.payments.brasilPixKey,
      expiresAt: orderExpiry,
    };
  }

  /** Public view of an order for the /checkout page. */
  public static async getOrderPublic(referenceCode: string) {
    const order = await prisma.paymentOrder.findUnique({
      where: { referenceCode },
      include: { subscription: true, user: { select: { fullName: true, email: true } } },
    });
    if (!order) return null;
    const isPY = order.currency === 'PYG';
    // Link de pasarela externa = una URL absoluta que NO es nuestra propia página /checkout.
    const link = order.paymentLink || '';
    const externalRedirect =
      link.startsWith('http') && !link.startsWith(config.frontendUrl) ? link : undefined;
    // Bancard se paga con su iframe (bancard-checkout-4.0.0.js + Bancard.Checkout.createForm),
    // no con el redirect a /checkout/new/{id} (bloqueado por el WAF del comercio). La página
    // /checkout necesita el process_id de Bancard, que quedó embebido en paymentLink.
    const bancardProcessId =
      order.gateway === 'BANCARD' && link.includes('/checkout/new/')
        ? link.split('/checkout/new/').pop() || undefined
        : undefined;
    return {
      referenceCode: order.referenceCode,
      status: order.status,
      gateway: order.gateway,
      paymentMethod: order.paymentMethod,
      amount: order.amount,
      currency: order.currency,
      formattedAmount: isPY ? `Gs. ${order.amount.toLocaleString('es-PY')}` : `R$ ${order.amount.toFixed(2)}`,
      plan: order.subscription?.plan,
      aliasInfo: order.aliasInfo,
      pixPayload: order.pixPayload,
      pixQrImage: order.pixQrImage,
      pixKey: config.payments.brasilPixKey,
      externalRedirect,
      bancardProcessId,
      bancardBaseUrl: bancardProcessId ? config.bancard.baseUrl : undefined,
      expiresAt: order.expiresAt,
      customerName: order.user?.fullName,
    };
  }

  /**
   * Webhook / confirmation handler — activates the account, generates QR + sticker PDF,
   * emails the invoice and pushes the confirmation over WhatsApp + Web Push.
   */
  public static async handlePaymentSuccess(referenceCode: string): Promise<boolean> {
    const order = await prisma.paymentOrder.findUnique({
      where: { referenceCode },
      include: { user: { include: { organization: true } }, subscription: true },
    });
    if (!order || order.status === 'PAID') return false;

    await prisma.paymentOrder.update({
      where: { id: order.id },
      data: { status: 'PAID', paidAt: new Date() },
    });

    if (order.subscriptionId) {
      await prisma.subscription.update({
        where: { id: order.subscriptionId },
        data: { status: 'ACTIVE', finePending: false, lastNotification: 'NONE' },
      });
    }

    const updatedUser = await prisma.user.update({
      where: { id: order.userId },
      data: { status: 'ACTIVE', onboardingState: 'ACTIVE_MEMBER' },
    });

    const sticker = await QrPdfService.generateStickerPdf({
      emergencyToken: updatedUser.emergencyToken,
      userName: updatedUser.fullName || 'Usuario Bio-Pass',
      bloodType: updatedUser.bloodType || 'RH Registrado',
      organizationName: order.user.organization?.name,
    });

    const emergencyUrl = `${config.publicEmergencyBaseUrl}/${updatedUser.emergencyToken}`;
    const isPY = order.currency === 'PYG';
    const amountFormatted = isPY ? `Gs. ${order.amount.toLocaleString('es-PY')}` : `R$ ${order.amount.toFixed(2)}`;

    // Invoice email (best-effort)
    if (updatedUser.email) {
      EmailService.sendInvoice(updatedUser.email, {
        fullName: updatedUser.fullName || '',
        plan: order.subscription?.plan || '—',
        amountFormatted,
        referenceCode,
        paidAt: new Date(),
        emergencyUrl,
      }).catch((e) => console.error('[payment] invoice email failed:', e?.message));
    }

    // Push confirmation (best-effort)
    PushService.sendToUser(updatedUser.id, {
      title: '✅ Pago confirmado — Bio-Pass activo',
      body: `${amountFormatted} · ${order.subscription?.plan || ''}. Tu QR de rescate ya está activo.`,
      tag: 'biopass-payment',
      url: '/dashboard',
    }).catch(() => {});

    const welcomeMsg =
      `🎉 *¡PAGO CONFIRMADO Y SERVICIO ACTIVADO!*\n\n` +
      `Bienvenido a *Doorway Cortex Bio-Pass*, ${updatedUser.fullName || ''}.\n\n` +
      `✅ Tu código de emergencia ya está activo.\n` +
      `🌐 *Tu enlace público:* ${emergencyUrl}\n\n` +
      `📄 *Descarga tu Kit de Stickers (3x3 cm):*\n${sticker.fileUrl}\n\n` +
      (updatedUser.email ? `📧 Te enviamos el comprobante a ${updatedUser.email}.\n\n` : '') +
      `⚙️ *Menú:* enviá *1* subir estudio · *2* editar perfil · *3* descargar QR · *4* soporte`;

    await whatsappBot.sendMessage(updatedUser.whatsappJid || updatedUser.phoneNumber, welcomeMsg);
    return true;
  }
}
