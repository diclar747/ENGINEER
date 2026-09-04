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
      { timeout: 30_000 }
    );

    if (data?.status !== 'success' || !data?.process_id) {
      throw new Error(`Bancard single_buy failed: ${JSON.stringify(data?.messages || data)}`);
    }

    return {
      processId: String(data.process_id),
      redirectUrl: `${config.bancard.baseUrl}/checkout/new/${data.process_id}`,
    };
  }

  /** Verifies a transaction after Bancard hits the return_url / webhook. */
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
      { timeout: 30_000 }
    );

    const resp = data?.confirmation;
    const approved =
      data?.status === 'success' &&
      (resp?.response === 'S' || resp?.response_code === '00' || /aprobad/i.test(resp?.response_description || ''));
    return { approved, raw: data };
  }
}
