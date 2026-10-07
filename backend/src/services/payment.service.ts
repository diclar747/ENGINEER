import { prisma } from '../database/prisma';
import { config } from '../config';
import { QrPdfService } from './qr-pdf.service';
import { whatsappBot } from '../whatsapp/baileys.client';
import { PushService } from './push.service';
import { EmailService } from './email.service';
import { StorageService } from '../storage/storage.service';
import { ReferralService } from './referral.service';
import { BancardService } from './bancard.service';

export interface CreateOrderParams {
  userId: string;
  plan: 'MONTHLY' | 'ANNUAL';
  country: 'PARAGUAY' | 'BRASIL' | 'USA';
  paymentMethod?: string;
  isFine?: boolean;
  /** Renovación: la orden cuelga de esta suscripción existente en vez de crear una nueva. */
  subscriptionId?: string;
}

interface PlanPriceTable {
  PY: { MONTHLY: number; ANNUAL: number; FINE: number };
  BR: { MONTHLY: number; ANNUAL: number; FINE: number };
  USA: { MONTHLY: number; ANNUAL: number; FINE: number };
}

/** Formatea el monto en la moneda del país. */
function formatAmount(country: CreateOrderParams['country'], amount: number): string {
  return country === 'PARAGUAY' ? fmtGs(amount) : fmtUsd(amount);
}

/** Gs. con separador de miles fijo (no depende del ICU del contenedor). */
export function fmtGs(n: number): string {
  return `Gs. ${Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
}
export function fmtUsd(n: number): string {
  return `U$ ${n.toFixed(2)}`;
}
export function fmtMoney(currency: string, n: number): string {
  return currency === 'PYG' ? fmtGs(n) : fmtUsd(n);
}

/**
 * Lee un monto tipeado a mano en el panel. El guaraní no tiene decimales, así que
 * "150.000" son ciento cincuenta mil (antes se leía como 150). En dólares se
 * acepta coma o punto decimal ("2,60" / "2.6 U$").
 */
export function parseMoney(raw: unknown, integerCurrency: boolean): number {
  const txt = String(raw ?? '');
  const n = integerCurrency
    ? Number(txt.replace(/\D/g, ''))
    : Number(txt.replace(',', '.').replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/** Suma el período del plan (12 meses o 1 mes) a una fecha. */
export function addPlanPeriod(from: Date, plan: 'MONTHLY' | 'ANNUAL' | string): Date {
  const d = new Date(from);
  d.setMonth(d.getMonth() + (plan === 'ANNUAL' ? 12 : 1));
  return d;
}

export class PaymentService {
  /**
   * Precios de los planes. Se leen de AppSetting (editables desde /admin → Contenido),
   * con fallback a config.payments.planPrices (env). Claves: price.py.monthly, price.py.annual,
   * price.py.fine, price.br.monthly, price.br.annual, price.br.fine, price.usa.monthly,
   * price.usa.annual, price.usa.fine.
   */
  public static async getPlanPrices(): Promise<PlanPriceTable> {
    const def = config.payments.planPrices;
    try {
      const rows = await prisma.appSetting.findMany({ where: { key: { startsWith: 'price.' } } });
      const s = Object.fromEntries(rows.map((r) => [r.key, r.value]));
      const num = (k: string, fb: number) => {
        const n = parseMoney(s[k], k.startsWith('price.py.'));
        return n > 0 ? n : fb;
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
        USA: {
          MONTHLY: num('price.usa.monthly', def.USA.MONTHLY),
          ANNUAL: num('price.usa.annual', def.USA.ANNUAL),
          FINE: num('price.usa.fine', def.USA.FINE),
        },
      };
    } catch {
      return { PY: { ...def.PY }, BR: { ...def.BR }, USA: { ...def.USA } };
    }
  }

  /**
   * Métodos / alias de pago por país, editables desde /admin (PUT /admin/settings),
   * con fallback a config/env. Claves AppSetting:
   *   pay.py.bank · pay.py.alias · pay.py.tigo · pay.py.extra  (líneas libres: Pagopar, Personal Pay, tPago…)
   *   pay.br.pix · pay.br.extra
   *   pay.usa.paypal · pay.usa.zelle · pay.usa.extra
   */
  public static async getPaymentMethods(): Promise<{
    py: { bank: string; alias: string; tigo: string; extra: string };
    br: { pix: string; extra: string };
    usa: { paypal: string; zelle: string; extra: string };
    adminWhatsapp: string[];
  }> {
    const c = config.payments;
    let s: Record<string, string> = {};
    try {
      const rows = await prisma.appSetting.findMany({ where: { key: { startsWith: 'pay.' } } });
      s = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    } catch {
      /* usa fallback */
    }
    return {
      py: {
        bank: s['pay.py.bank'] || c.paraguayBank,
        alias: s['pay.py.alias'] || c.paraguayAlias,
        tigo: s['pay.py.tigo'] || c.paraguayTigoWallet,
        extra: s['pay.py.extra'] || '',
      },
      br: {
        // Brasil cobra en dólares: la clave PIX solo se muestra si se cargó a mano en el panel.
        pix: s['pay.br.pix'] || '',
        extra: s['pay.br.extra'] || '',
      },
      usa: {
        paypal: s['pay.usa.paypal'] || c.usaPaypal,
        zelle: s['pay.usa.zelle'] || c.usaZelle,
        extra: s['pay.usa.extra'] || '',
      },
      // WhatsApp de quienes confirman los pagos por alias (reciben el comprobante y
      // pueden responder "OK BIO-…"). Varios separados por coma.
      adminWhatsapp: String(s['pay.admin.whatsapp'] || process.env.BILLING_ADMIN_WHATSAPP || '')
        .split(/[,;\s]+/)
        .map((x) => x.replace(/\D/g, ''))
        .filter((x) => x.length >= 7),
    };
  }

  /** Texto de precios para el bot y la IA: Paraguay en guaraníes, el resto en dólares. */
  public static async priceText(lang: string = 'es'): Promise<string> {
    const p = await PaymentService.getPlanPrices();
    const l = (lang || 'es').toLowerCase();
    if (l === 'pt') {
      return (
        `💰 *Preços do Bio-Pass*\n\n` +
        `🇵🇾 *Paraguai:* ${fmtGs(p.PY.MONTHLY)} por mês, ou ${fmtGs(p.PY.ANNUAL)} por 12 meses.\n` +
        `🌎 *Brasil, resto da América do Sul e EUA:* ${fmtUsd(p.USA.MONTHLY)} por mês, ou ${fmtUsd(p.USA.ANNUAL)} por 12 meses.\n\n` +
        `_No plano anual você paga 10 meses e usa 12._`
      );
    }
    if (l === 'en') {
      return (
        `💰 *Bio-Pass pricing*\n\n` +
        `🇵🇾 *Paraguay:* ${fmtGs(p.PY.MONTHLY)} per month, or ${fmtGs(p.PY.ANNUAL)} for 12 months.\n` +
        `🌎 *Brazil, rest of South America and USA:* ${fmtUsd(p.USA.MONTHLY)} per month, or ${fmtUsd(p.USA.ANNUAL)} for 12 months.\n\n` +
        `_The annual plan charges 10 months for 12._`
      );
    }
    return (
      `💰 *Precios de Bio-Pass*\n\n` +
      `🇵🇾 *Paraguay:* ${fmtGs(p.PY.MONTHLY)} por mes, o ${fmtGs(p.PY.ANNUAL)} por 12 meses.\n` +
      `🌎 *Brasil, resto de Sudamérica y EE.UU.:* ${fmtUsd(p.USA.MONTHLY)} por mes, o ${fmtUsd(p.USA.ANNUAL)} por 12 meses.\n\n` +
      `_En el plan anual pagás 10 meses y usás 12._\n` +
      `🎁 _Promo: traé un cliente y ganás 1 mes gratis._`
    );
  }

  /** Instrucciones de pago manual por país (alias en Paraguay; PayPal/Zelle afuera). */
  private static async manualInstructions(country: CreateOrderParams['country'], referenceCode: string): Promise<string> {
    const m = await PaymentService.getPaymentMethods();
    if (country === 'PARAGUAY') {
      return (
        `ALIAS: ${m.py.alias}\n` +
        (m.py.bank ? `BANCO: ${m.py.bank}\n` : '') +
        (m.py.tigo ? `TIGO MONEY: ${m.py.tigo}\n` : '') +
        (m.py.extra ? `${m.py.extra}\n` : '') +
        `REF: ${referenceCode}`
      );
    }
    return (
      (m.usa.paypal ? `PAYPAL: ${m.usa.paypal}\n` : '') +
      (m.usa.zelle ? `ZELLE: ${m.usa.zelle}\n` : '') +
      (country === 'BRASIL' && m.br.pix ? `PIX: ${m.br.pix}\n` : '') +
      (country === 'BRASIL' && m.br.extra ? `${m.br.extra}\n` : '') +
      (country !== 'BRASIL' && m.usa.extra ? `${m.usa.extra}\n` : '') +
      `REF: ${referenceCode}`
    );
  }

  /**
   * Suscripción "viva" del titular: la de vencimiento más lejano entre las que
   * alguna vez estuvieron pagas. Es la que mira el cron de cobranzas y la que
   * extiende una renovación.
   */
  public static async currentSubscription(userId: string) {
    return prisma.subscription.findFirst({
      where: { userId, status: { in: ['ACTIVE', 'EXPIRED', 'CANCELLED', 'PAUSED'] } },
      orderBy: { expiryDate: 'desc' },
    });
  }

  /**
   * Orden de RENOVACIÓN: cuelga de la suscripción vigente (no crea otra) y se
   * reutiliza mientras siga pendiente y el precio no haya cambiado. Antes cada
   * aviso —y cada mensaje de un titular vencido— generaba una suscripción y una
   * orden nuevas.
   */
  public static async getRenewalOrder(userId: string) {
    const sub = await PaymentService.currentSubscription(userId);
    if (!sub) {
      return PaymentService.createPaymentOrder({ userId, plan: 'MONTHLY', country: 'PARAGUAY' });
    }
    const country: CreateOrderParams['country'] = sub.country === 'PARAGUAY' ? 'PARAGUAY' : sub.country === 'BRASIL' ? 'BRASIL' : 'USA';
    const prices = await PaymentService.getPlanPrices();
    const P = country === 'PARAGUAY' ? prices.PY : country === 'BRASIL' ? prices.BR : prices.USA;
    const amount = sub.plan === 'ANNUAL' ? P.ANNUAL : P.MONTHLY;
    const since = new Date(Date.now() - 30 * 86400_000);
    const open = await prisma.paymentOrder.findFirst({
      where: { userId, subscriptionId: sub.id, status: 'PENDING', amount, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
    });
    if (open) {
      return {
        orderId: open.id,
        referenceCode: open.referenceCode,
        amount: open.amount,
        currency: open.currency,
        formattedAmount: fmtMoney(open.currency, open.amount),
        plan: sub.plan,
        country,
        paymentLink: `${config.frontendUrl}/checkout?ref=${open.referenceCode}`,
        aliasInfo: await PaymentService.manualInstructions(country, open.referenceCode),
      };
    }
    return PaymentService.createPaymentOrder({ userId, plan: sub.plan, country, subscriptionId: sub.id });
  }

  /** Bloque de texto "cómo pagar" que usan los avisos de cobranza y el bot. */
  public static payBlock(order: { country: string; formattedAmount: string; referenceCode: string; paymentLink: string; aliasInfo?: string | null }, lang: string = 'es'): string {
    const l = (lang || 'es').toLowerCase();
    const alias = (order.aliasInfo || '').trim();
    if (order.country === 'PARAGUAY') {
      return (
        `💰 *Monto:* ${order.formattedAmount}\n\n` +
        `💳 *Pagar con Bancard (tarjeta o QR):*\n${order.paymentLink}\n\n` +
        `🏦 *O por transferencia al Alias:*\n${alias}\n\n` +
        `📸 _Si pagás por alias, mandame acá la foto del comprobante y lo acreditamos._`
      );
    }
    if (l === 'pt') {
      return (
        `💰 *Valor:* ${order.formattedAmount}\n\n` +
        `🌐 *Pagar online:*\n${order.paymentLink}\n\n` +
        (alias ? `💵 *Ou por transferência:*\n${alias}\n\n` : '') +
        `📸 _Se pagar por transferência, envie aqui a foto do comprovante._`
      );
    }
    if (l === 'en') {
      return (
        `💰 *Amount:* ${order.formattedAmount}\n\n` +
        `🌐 *Pay online:*\n${order.paymentLink}\n\n` +
        (alias ? `💵 *Or by transfer:*\n${alias}\n\n` : '') +
        `📸 _If you pay by transfer, send the receipt photo here._`
      );
    }
    return (
      `💰 *Monto:* ${order.formattedAmount}\n\n` +
      `🌐 *Pagar online:*\n${order.paymentLink}\n\n` +
      (alias ? `💵 *O por transferencia:*\n${alias}\n\n` : '') +
      `📸 _Si pagás por transferencia, mandame acá la foto del comprobante._`
    );
  }

  /**
   * El titular mandó el comprobante de una transferencia/alias: se guarda en la
   * orden pendiente y se avisa a quien confirma los pagos. No activa nada solo —
   * una foto no prueba que la plata entró; lo confirma una persona (panel
   * /admin → Pagos → "Marcar pagado", o respondiendo "OK BIO-…" por WhatsApp).
   */
  public static async attachProof(userId: string, buffer: Buffer, ext: string, mimetype?: string): Promise<{ referenceCode: string; formattedAmount: string } | null> {
    // Socio que renueva → la orden de renovación de su suscripción vigente (monto y
    // precio actuales). Alta nueva → la orden que generó al elegir plan.
    const hasSub = await PaymentService.currentSubscription(userId);
    let order = hasSub
      ? null
      : await prisma.paymentOrder.findFirst({ where: { userId, status: 'PENDING' }, orderBy: { createdAt: 'desc' } });
    if (!order) {
      const created = await PaymentService.getRenewalOrder(userId);
      order = await prisma.paymentOrder.findUnique({ where: { referenceCode: created.referenceCode } });
    }
    if (!order) return null;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    const safeExt = /^(jpg|png|pdf|webp|heic)$/.test(ext) ? ext : 'jpg';
    const name = `proof_${order.referenceCode}_${Date.now()}.${safeExt}`;
    await StorageService.saveFile('payment_proofs', name, buffer);
    await prisma.paymentOrder.update({ where: { id: order.id }, data: { proofFile: name, proofAt: new Date() } });

    const formattedAmount = fmtMoney(order.currency, order.amount);
    const { adminWhatsapp } = await PaymentService.getPaymentMethods();
    const note =
      `🧾 *Comprobante de pago recibido*\n\n` +
      `👤 ${user?.fullName || 'Sin nombre'} (${user?.phoneNumber || ''})\n` +
      `💰 ${formattedAmount}\n` +
      `🔢 ${order.referenceCode}\n\n` +
      `Revisá que la plata haya entrado y respondé:\n*OK ${order.referenceCode}*\n` +
      `_(o marcá el pago en el panel → Pagos)_`;
    for (const admin of adminWhatsapp) {
      try {
        if (safeExt === 'pdf') await whatsappBot.sendDocument(admin, buffer, `Comprobante ${order.referenceCode}.pdf`, 'application/pdf', note);
        else await whatsappBot.sendImage(admin, buffer, note, mimetype || 'image/jpeg');
      } catch (e: any) {
        console.error('[payment] no se pudo reenviar el comprobante al admin:', e?.message || e);
        await whatsappBot.sendMessage(admin, note).catch(() => false);
      }
    }
    return { referenceCode: order.referenceCode, formattedAmount };
  }

  /**
   * Creates a payment order for Paraguay, Brasil or USA.
   * - PY: Bancard vPOS hosted checkout when configured, plus alias/transfer instructions as fallback.
   * - BR: real Pix BR Code (valid CRC16) or Mercado Pago Pix charge.
   * - USA: instrucciones manuales (PayPal / Zelle), editables desde /admin — no hay gateway de
   *   tarjeta USD integrado; se confirma manual como la transferencia SIPAP de Paraguay.
   * The `paymentLink` always points to the in-app /checkout page, which renders the right method.
   */
  public static async createPaymentOrder(params: CreateOrderParams) {
    const user = await prisma.user.findUnique({
      where: { id: params.userId },
      include: { organization: true },
    });
    if (!user) throw new Error('User not found');

    const isPY = params.country === 'PARAGUAY';
    // Todo lo que no es Paraguay (Brasil, resto de Sudamérica, EE.UU.) cobra en dólares.
    const isUSA = !isPY;
    const currency = isPY ? 'PYG' : 'USD';
    // Precios editables desde el panel admin (AppSetting price.*), con fallback al config/env.
    const prices = await PaymentService.getPlanPrices();
    const P = isPY ? prices.PY : params.country === 'BRASIL' ? prices.BR : prices.USA;
    // Sin multas: el atraso deja la cuenta en espera y se reactiva pagando la cuota normal.
    const baseAmount = params.plan === 'ANNUAL' ? P.ANNUAL : P.MONTHLY;

    const shopProcessId = Date.now().toString();
    const referenceCode = `BIO-${shopProcessId}-${Math.floor(1000 + Math.random() * 9000)}`;

    // El vencimiento real se fija al acreditarse el pago (handlePaymentSuccess).
    const existing = params.subscriptionId
      ? await prisma.subscription.findFirst({ where: { id: params.subscriptionId, userId: user.id } })
      : null;
    const subscription =
      existing ||
      (await prisma.subscription.create({
        data: {
          userId: user.id,
          plan: params.plan,
          country: params.country,
          currency,
          amount: baseAmount,
          status: 'PENDING_PAYMENT',
          expiryDate: addPlanPeriod(new Date(), params.plan),
        },
      }));

    const checkoutLink = `${config.frontendUrl}/checkout?ref=${referenceCode}`;
    let aliasInfo: string | undefined;
    const pixPayload: string | undefined = undefined;
    const pixQrImage: string | undefined = undefined;
    let gatewayRef: string | undefined;
    let gateway: 'MERCADOPAGO' | 'PIX' | 'BANCARD' | 'BANK_TRANSFER' = 'BANK_TRANSFER';
    let paymentMethod = isPY ? 'ALIAS / TRANSFERENCIA' : 'PAYPAL / ZELLE';
    let externalRedirect: string | undefined;
    const orderExpiry: Date | undefined = undefined;

    const methods = await PaymentService.getPaymentMethods();
    aliasInfo = await PaymentService.manualInstructions(params.country, referenceCode);
    if (isPY) {
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
        // OJO: el `process_id` de Bancard NO tiene página propia navegable
        // (`/checkout/new/<id>` responde 404) y además vence a los pocos minutos.
        // Sólo sirve para montar el form con el SDK `bancard-checkout-4.0.0.js`
        // dentro de nuestra página /checkout. Por eso NO se genera un QR de ese
        // link (daba un QR que llevaba a "No encontrado" de Bancard).
      } else {
        console.warn(
          '[payment] BANCARD_PUBLIC_KEY / BANCARD_PRIVATE_KEY sin configurar — la orden PY sale solo con instrucciones de transferencia manual.'
        );
      }
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
      formattedAmount: formatAmount(params.country, baseAmount),
      plan: params.plan,
      country: params.country,
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
      pixKey: methods.br.pix,
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
    const isUSD = order.currency === 'USD';
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
      formattedAmount: isPY ? fmtGs(order.amount) : isUSD ? fmtUsd(order.amount) : `R$ ${order.amount.toFixed(2)}`,
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

    // Vigencia: se cuenta desde el día en que entra el pago. Si es una renovación
    // hecha antes de vencer, el período nuevo se suma al que ya tenía (no pierde días).
    let isRenewal = false;
    let newExpiry: Date | null = null;
    if (order.subscription) {
      const sub = order.subscription;
      const now = new Date();
      isRenewal = sub.status !== 'PENDING_PAYMENT';
      let base = now;
      if (isRenewal) {
        if (sub.expiryDate > now) base = sub.expiryDate;
      } else {
        const prev = await prisma.subscription.findFirst({
          where: { userId: order.userId, id: { not: sub.id }, status: { in: ['ACTIVE', 'EXPIRED', 'CANCELLED'] } },
          orderBy: { expiryDate: 'desc' },
        });
        if (prev) isRenewal = true;
        if (prev && prev.expiryDate > now) base = prev.expiryDate;
      }
      newExpiry = addPlanPeriod(base, sub.plan);
      await prisma.subscription.update({
        where: { id: sub.id },
        data: {
          status: 'ACTIVE',
          finePending: false,
          fineAmount: 0,
          lastNotification: 'NONE',
          expiryDate: newExpiry,
          ...(isRenewal ? {} : { startDate: now }),
        },
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
      organizationLogoUrl: order.user.organization?.logoUrl || undefined,
    });

    const emergencyUrl = `${config.publicEmergencyBaseUrl}/${updatedUser.emergencyToken}`;
    const isPY = order.currency === 'PYG';
    const isUSD = order.currency === 'USD';
    const amountFormatted = isPY ? fmtGs(order.amount) : isUSD ? fmtUsd(order.amount) : `R$ ${order.amount.toFixed(2)}`;
    const destino = updatedUser.whatsappJid || updatedUser.phoneNumber;
    const hasta = newExpiry ? newExpiry.toLocaleDateString('es-PY', { timeZone: config.timezone }) : '';

    // Renovación: aviso corto. No se repite la bienvenida ni se reenvía el kit de
    // stickers (el QR es el mismo de siempre).
    if (isRenewal) {
      PushService.sendToUser(updatedUser.id, {
        title: '✅ Renovación confirmada — Bio-Pass',
        body: `${amountFormatted}. Tu Bio-Pass sigue activo${hasta ? ` hasta el ${hasta}` : ''}.`,
        tag: 'biopass-payment',
        url: '/dashboard',
      }).catch(() => {});
      await whatsappBot.sendMessage(
        destino,
        `✅ *¡Pago recibido! Tu Bio-Pass quedó renovado.*\n\n` +
          `💰 ${amountFormatted}\n` +
          (hasta ? `📅 Vigente hasta el *${hasta}*\n` : '') +
          `\nTu QR de emergencia y tu historial siguen activos. ¡Gracias por seguir con nosotros!`
      );
      return true;
    }

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
      `📄 *Tu Kit de Stickers (3x3 cm) va acá abajo, como archivo.*\n\n` +
      (updatedUser.email ? `📧 Te enviamos el comprobante a ${updatedUser.email}.\n\n` : '') +
      `🔔 *Activá notificaciones push en tu celular* (además del aviso acá por WhatsApp cada vez que alguien escanea tu QR):\n${config.frontendUrl}/push/${updatedUser.emergencyToken}\n\n` +
      `⚙️ Escribí *MENU* para ver todas tus opciones: cargar medicación, recetas y estudios (por separado), ver tu perfil médico, programar recordatorios de medicación y turnos, descargar tu Kit de Stickers/QR, modificar tus datos de emergencia, o hablar con soporte.`;

    await whatsappBot.sendMessage(destino, welcomeMsg);
    // El PDF va como ARCHIVO, no como link: el nombre real lleva guiones bajos
    // ("qr_stickers/sticker_<token>.pdf") y WhatsApp los interpreta como marca de
    // cursiva y se los come, así que el enlace que veía la persona daba 404.
    // Además /uploads ya no entrega nada sin una URL firmada.
    await whatsappBot
      .sendDocument(destino, sticker.pdfBuffer, `Bio-Pass stickers ${updatedUser.fullName || ''}`.trim() + '.pdf', 'application/pdf', 'Kit de stickers 3x3 cm y QR')
      .catch((e) => console.error('[payment] no se pudo mandar el PDF de stickers:', e?.message || e));
    // Promo "traé un cliente": primer pago de un invitado → 1 mes gratis a quien lo invitó.
    await ReferralService.rewardIfDue(updatedUser.id).catch((e) => console.error('[referral] no se pudo acreditar el mes gratis:', e?.message || e));
    return true;
  }

  /**
   * Respiro sin cobrar (flujo de retención de baja voluntaria): suma `days` a la
   * suscripción vigente (o crea una si no había) y reactiva al usuario, igual que
   * `admin.controller.extendSubscription` pero pensado para uso desde el bot.
   */
  public static async grantCourtesyDays(userId: string, days: number, opts: { retention?: boolean } = { retention: true }): Promise<Date> {
    const latest = await PaymentService.currentSubscription(userId);
    const base = latest && latest.expiryDate > new Date() ? new Date(latest.expiryDate) : new Date();
    base.setDate(base.getDate() + days);

    if (latest) {
      await prisma.subscription.update({
        where: { id: latest.id },
        data: { expiryDate: base, status: 'ACTIVE', finePending: false, fineAmount: 0, lastNotification: 'NONE' },
      });
    } else {
      await prisma.subscription.create({
        data: { userId, plan: 'MONTHLY', country: 'PARAGUAY', currency: 'PYG', amount: 0, status: 'ACTIVE', expiryDate: base, lastNotification: 'NONE' },
      });
    }
    await prisma.user.update({
      where: { id: userId },
      data: { status: 'ACTIVE', ...(opts.retention === false ? {} : { retentionOfferUsedAt: new Date() }) },
    });
    return base;
  }
}
