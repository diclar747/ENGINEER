import { prisma } from '../database/prisma';
import { config } from '../config';
import { QrPdfService } from './qr-pdf.service';
import { whatsappBot } from '../whatsapp/baileys.client';
import { PushService } from './push.service';
import { EmailService } from './email.service';
import { PixService } from './pix.service';
import { BancardService } from './bancard.service';
import { WinsapService } from './winsap.service';
import QRCode from 'qrcode';

export interface CreateOrderParams {
  userId: string;
  plan: 'MONTHLY' | 'ANNUAL';
  country: 'PARAGUAY' | 'BRASIL';
  paymentMethod?: string;
  isFine?: boolean;
}

export class PaymentService {
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
    let baseAmount = isPY
      ? params.plan === 'ANNUAL' ? config.payments.planPrices.PY.ANNUAL : config.payments.planPrices.PY.MONTHLY
      : params.plan === 'ANNUAL' ? config.payments.planPrices.BR.ANNUAL : config.payments.planPrices.BR.MONTHLY;
    if (params.isFine) baseAmount += isPY ? config.payments.planPrices.PY.FINE : config.payments.planPrices.BR.FINE;

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
        fineAmount: params.isFine ? (isPY ? config.payments.planPrices.PY.FINE : config.payments.planPrices.BR.FINE) : 0,
      },
    });

    const checkoutLink = `${config.frontendUrl}/checkout?ref=${referenceCode}`;
    let aliasInfo: string | undefined;
    let pixPayload: string | undefined;
    let pixQrImage: string | undefined;
    let gatewayRef: string | undefined;
    let gateway: 'MERCADOPAGO' | 'PIX' | 'BANCARD' | 'BANK_TRANSFER' | 'WINSAP' = isPY ? 'BANK_TRANSFER' : 'PIX';
    let paymentMethod = isPY ? 'ALIAS / TRANSFERENCIA' : 'PIX';
    let externalRedirect: string | undefined;
    let orderExpiry: Date | undefined;

    if (isPY) {
      // Always provide the manual transfer instructions
      aliasInfo =
        `BANCO: ${config.payments.paraguayBank}\n` +
        `ALIAS SIPAP: ${config.payments.paraguayAlias}\n` +
        `BILLETERA TIGO MONEY: ${config.payments.paraguayTigoWallet}\n` +
        `TITULAR: DOORWAY CORTEX BIO-PASS PY\n` +
        `REF: ${referenceCode}`;

      // Prefer Winsap (hosted checkout QR sent straight in the chat) when configured.
      if (WinsapService.enabled) {
        const link = await WinsapService.createPaymentLink({
          name: `Bio-Pass ${params.plan === 'ANNUAL' ? 'Plan Anual' : 'Plan Mensual'}`,
          price: baseAmount,
          currency: 'PYG',
          description: `Suscripción Bio-Pass (${params.plan}) — ${user.fullName || user.phoneNumber}`,
          reference: referenceCode,
          successUrl: `${checkoutLink}&status=success`,
          cancelUrl: `${checkoutLink}&status=cancel`,
        });
        if (link) {
          gateway = 'WINSAP';
          paymentMethod = 'QR / Tarjeta (Winsap)';
          gatewayRef = link.id;
          externalRedirect = link.paymentUrl;
          try {
            pixQrImage = await QRCode.toDataURL(link.paymentUrl, { errorCorrectionLevel: 'M', margin: 1, width: 320 });
          } catch (err: any) {
            console.warn('[payment] Winsap QR render failed:', err?.message);
          }
        }
      }

      if (!externalRedirect && BancardService.enabled) {
        try {
          const checkout = await BancardService.createCheckout({
            shopProcessId,
            amount: baseAmount,
            currency: 'PYG',
            description: `Bio-Pass ${params.plan}`,
            returnUrl: `${config.baseUrl}/api/payments/bancard/return?ref=${referenceCode}`,
            cancelUrl: `${checkoutLink}&status=cancel`,
          });
          gateway = 'BANCARD';
          paymentMethod = 'CARD / QR (Bancard)';
          gatewayRef = checkout.processId;
          externalRedirect = checkout.redirectUrl;
        } catch (err: any) {
          console.warn('[payment] Bancard checkout failed, using transfer instructions only:', err?.message);
        }
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
      paymentLink: externalRedirect || checkoutLink,
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
      externalRedirect: order.paymentLink?.startsWith('http') && !order.paymentLink.includes('/checkout') ? order.paymentLink : undefined,
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
