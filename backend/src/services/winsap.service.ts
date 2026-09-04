import axios from 'axios';
import { config } from '../config';

export interface WinsapLink {
  paymentUrl: string;
  token: string;
  id: string;
}

/**
 * Winsap "payment links" API (https://winsap.com.py/api-docs, pestaña Pagos).
 * Auth: header X-API-KEY. Creating a link returns a hosted checkout page
 * (payment_url) where the customer picks Bancard / QR / card; the QR itself is
 * rendered on that page, not returned by the API, so we render our own QR
 * pointing at payment_url and send it as an image.
 */
export class WinsapService {
  static get enabled(): boolean {
    return !!config.winsap.apiKey;
  }

  static async createPaymentLink(opts: {
    name: string;
    price: number;
    currency?: string;
    description?: string;
    reference?: string;
    successUrl?: string;
    cancelUrl?: string;
  }): Promise<WinsapLink | null> {
    if (!this.enabled) return null;
    try {
      const { data } = await axios.post(
        `${config.winsap.baseUrl}/payment-links`,
        {
          name: opts.name,
          price: Math.round(opts.price),
          currency: opts.currency || 'PYG',
          description: opts.description,
          reference: opts.reference,
          success_url: opts.successUrl,
          cancel_url: opts.cancelUrl,
        },
        { headers: { 'X-API-KEY': config.winsap.apiKey }, timeout: 15000 },
      );
      if (!data?.success || !data?.data?.payment_url) return null;
      return {
        paymentUrl: data.data.payment_url,
        token: data.data.token,
        id: String(data.data.id),
      };
    } catch (err: any) {
      console.warn('[WINSAP] createPaymentLink error:', err?.response?.status, err?.response?.data?.error || err?.message);
      return null;
    }
  }

  /**
   * Real status check against Winsap's transaction list — used before activating
   * a subscription on "PAGAR" instead of trusting the user's word.
   * Returns the Winsap status string (e.g. 'paid', 'pending', 'cancelled') or null
   * if no matching transaction / the API call failed.
   */
  static async getStatusByReference(reference: string): Promise<string | null> {
    if (!this.enabled || !reference) return null;
    try {
      const { data } = await axios.get(`${config.winsap.baseUrl}/payments`, {
        headers: { 'X-API-KEY': config.winsap.apiKey },
        timeout: 15000,
      });
      const rows: any[] = Array.isArray(data?.data) ? data.data : [];
      const match = rows.find((p) => p.reference === reference);
      return match?.status ?? null;
    } catch (err: any) {
      console.warn('[WINSAP] getStatusByReference error:', err?.response?.status, err?.message);
      return null;
    }
  }
}
