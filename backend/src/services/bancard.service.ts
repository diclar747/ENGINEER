import crypto from 'crypto';
import axios from 'axios';
import { config } from '../config';

export interface BancardCheckout {
  processId: string;
  redirectUrl: string;    // hosted checkout page
}

const md5 = (s: string) => crypto.createHash('md5').update(s).digest('hex');

/**
 * Bancard vPOS (Paraguay) — "single buy" hosted checkout.
 * Docs: https://vpos.infonet.com.py/vpos/api-doc
 * When keys are absent the payment order simply falls back to alias/transfer
 * instructions (handled in PaymentService), so this service is only called when enabled.
 */
export class BancardService {
  static get enabled(): boolean {
    return config.bancard.enabled;
  }

  /** Amounts are sent with 2 decimals; PYG has no cents so we send "1000.00". */
  private static fmt(amount: number): string {
    return amount.toFixed(2);
  }

  static async createCheckout(params: {
    shopProcessId: string;   // numeric, unique per attempt
    amount: number;
    currency: 'PYG' | 'USD';
    description: string;
    returnUrl: string;
    cancelUrl: string;
  }): Promise<BancardCheckout> {
    const amount = this.fmt(params.amount);
    const token = md5(
      `${config.bancard.privateKey}${params.shopProcessId}${amount}${params.currency}`
    );

    const { data } = await axios.post(
      `${config.bancard.baseUrl}/vpos/api/0.3/single_buy`,
      {
        public_key: config.bancard.publicKey,
        operation: {
          token,
          shop_process_id: params.shopProcessId,
          amount,
          currency: params.currency,
          additional_data: '',
          description: params.description.slice(0, 20),
          return_url: params.returnUrl,
          cancel_url: params.cancelUrl,
        },
      },
      { timeout: 30_000, headers: { "User-Agent": "Mozilla/5.0 (compatible; BioPass/1.0)", Accept: "application/json" } }
    );

    if (data?.status !== 'success' || !data?.process_id) {
      throw new Error(`Bancard single_buy failed: ${JSON.stringify(data?.messages || data)}`);
    }

    const processId = String(data.process_id);
    return {
      processId,
      // Hosted redirect checkout (card + QR tabs rendered by Bancard).
      // The iframe alternative loads bancard-checkout-4.0.0.js and calls Bancard.Checkout.createForm(el, processId).
      redirectUrl: `${config.bancard.baseUrl}/checkout/new/${processId}`,
    };
  }

  /**
   * MD5 that a valid Bancard confirmation / webhook payload must carry, per the
   * reference portal (cardnet/backend/index.php): privateKey + shop_process_id + "confirm" + amount + currency.
   */
  static webhookToken(shopProcessId: string, amount: number, currency: 'PYG' | 'USD'): string {
    return md5(`${config.bancard.privateKey}${shopProcessId}confirm${this.fmt(amount)}${currency}`);
  }

  /**
   * Validates a Bancard webhook body against the expected order and reports approval.
   * Bancard sends: { operation: { token, shop_process_id, amount, currency, response, response_code, response_description, ... } }
   * Approved when response_code === "00" and response === "S".
   */
  static parseWebhook(
    body: any,
    expected: { amount: number; currency: 'PYG' | 'USD' }
  ): { valid: boolean; approved: boolean; shopProcessId: string; description?: string; raw: any } {
    const op = body?.operation;
    const shopProcessId = op?.shop_process_id != null ? String(op.shop_process_id) : '';
    if (!op || !shopProcessId || typeof op.token !== 'string') {
      return { valid: false, approved: false, shopProcessId, raw: body };
    }
    const expectedToken = this.webhookToken(shopProcessId, expected.amount, expected.currency);
    let valid = false;
    try {
      valid =
        op.token.length === expectedToken.length &&
        crypto.timingSafeEqual(Buffer.from(op.token), Buffer.from(expectedToken));
    } catch {
      valid = false;
    }
    const approved = op.response_code === '00' && op.response === 'S';
    return { valid, approved, shopProcessId, description: op.response_description, raw: body };
  }

  /** Verifies a transaction after Bancard hits the return_url / webhook. */
  /**
   * NOTE: this endpoint could not be validated against a completed live payment (returns
   * PaymentNotFoundError until a card is actually charged). The authoritative activation
   * path is the webhook (`parseWebhook` + POST /api/payments/bancard/webhook); this call
   * is only a best-effort immediate check from the browser return_url and its failure is
   * non-fatal (bancardReturn falls back to "pending" and the /checkout page keeps polling).
   */
  static async confirm(params: {
    shopProcessId: string;
    amount: number;
    currency: 'PYG' | 'USD';
  }): Promise<{ approved: boolean; raw: any }> {
    const amount = this.fmt(params.amount);
    const token = md5(
      `${config.bancard.privateKey}${params.shopProcessId}confirm${amount}${params.currency}`
    );

    const { data } = await axios.post(
      `${config.bancard.baseUrl}/vpos/api/0.3/single_buy/confirmations`,
      { public_key: config.bancard.publicKey, operation: { token, shop_process_id: params.shopProcessId } },
      { timeout: 30_000, headers: { "User-Agent": "Mozilla/5.0 (compatible; BioPass/1.0)", Accept: "application/json" } }
    );

    const resp = data?.confirmation;
    const approved =
      data?.status === 'success' &&
      (resp?.response === 'S' || resp?.response_code === '00' || /aprobad/i.test(resp?.response_description || ''));
    return { approved, raw: data };
  }
}
