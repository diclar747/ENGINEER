import axios from 'axios';
import QRCode from 'qrcode';
import { config } from '../config';

export interface PixCharge {
  payload: string;        // "copia e cola" (BR Code)
  qrImage: string;        // data:image/png;base64,...
  provider: 'mercadopago' | 'manual';
  gatewayRef?: string;    // PSP payment id (when applicable)
  expiresAt?: Date;
}

/** EMV / BR Code helpers (Banco Central do Brasil "Pix" spec). */
function emv(id: string, value: string): string {
  const len = value.length.toString().padStart(2, '0');
  return `${id}${len}${value}`;
}

/** CRC16/CCITT-FALSE, polynomial 0x1021, init 0xFFFF — as required by the BR Code spec. */
function crc16(input: string): string {
  let crc = 0xffff;
  for (let i = 0; i < input.length; i++) {
    crc ^= input.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function sanitize(text: string, max: number): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 ]/g, '')
    .toUpperCase()
    .slice(0, max)
    .trim();
}

/**
 * Builds a valid static Pix BR Code.
 * @param key      Pix key (email, phone, CPF/CNPJ or random)
 * @param amount   BRL amount (e.g. 220 or 25.5)
 * @param txid     transaction id, <=25 chars, [A-Za-z0-9]
 */
export function buildPixPayload(key: string, amount: number, txid: string): string {
  const name = sanitize(config.pix.merchantName, 25) || 'DOORWAY CORTEX';
  const city = sanitize(config.pix.merchantCity, 15) || 'SAO PAULO';
  const cleanTxid = txid.replace(/[^A-Za-z0-9]/g, '').slice(0, 25) || '***';

  const mai =
    emv('00', 'br.gov.bcb.pix') +
    emv('01', key.trim());

  let payload =
    emv('00', '01') +                                  // Payload Format Indicator
    emv('26', mai) +                                    // Merchant Account Information - Pix
    emv('52', '0000') +                                 // Merchant Category Code
    emv('53', '986') +                                  // Currency - BRL
    emv('54', amount.toFixed(2)) +                      // Amount
    emv('58', 'BR') +                                   // Country
    emv('59', name) +                                   // Merchant Name
    emv('60', city) +                                   // Merchant City
    emv('62', emv('05', cleanTxid)) +                   // Additional Data - reference label
    '6304';                                             // CRC placeholder

  payload += crc16(payload);
  return payload;
}

export class PixService {
  /** Creates a Pix charge. Uses Mercado Pago when PIX_PSP=mercadopago + token present; otherwise a valid static BR Code. */
  static async createCharge(params: {
    amountBRL: number;
    txid: string;
    description: string;
    payerEmail?: string;
  }): Promise<PixCharge> {
    if (config.pix.psp === 'mercadopago' && config.pix.mercadopagoToken) {
      try {
        return await this.createMercadoPagoCharge(params);
      } catch (err: any) {
        console.warn('[pix:mercadopago] falling back to static BR Code:', err?.response?.data?.message || err?.message);
      }
    }
    return this.createStaticCharge(params);
  }

  private static async createStaticCharge(params: { amountBRL: number; txid: string }): Promise<PixCharge> {
    const payload = buildPixPayload(config.payments.brasilPixKey, params.amountBRL, params.txid);
    const qrImage = await QRCode.toDataURL(payload, { errorCorrectionLevel: 'M', margin: 1, width: 320 });
    return { payload, qrImage, provider: 'manual' };
  }

  private static async createMercadoPagoCharge(params: {
    amountBRL: number;
    txid: string;
    description: string;
    payerEmail?: string;
  }): Promise<PixCharge> {
    const { data } = await axios.post(
      'https://api.mercadopago.com/v1/payments',
      {
        transaction_amount: Number(params.amountBRL.toFixed(2)),
        description: params.description,
        payment_method_id: 'pix',
        external_reference: params.txid,
        payer: { email: params.payerEmail || 'sem-email@bio-pass.com' },
      },
      {
        headers: {
          Authorization: `Bearer ${config.pix.mercadopagoToken}`,
          'X-Idempotency-Key': params.txid,
        },
        timeout: 30_000,
      }
    );
    const tx = data?.point_of_interaction?.transaction_data || {};
    const payload: string = tx.qr_code || buildPixPayload(config.payments.brasilPixKey, params.amountBRL, params.txid);
    const qrImage = tx.qr_code_base64
      ? `data:image/png;base64,${tx.qr_code_base64}`
      : await QRCode.toDataURL(payload, { margin: 1, width: 320 });
    return {
      payload,
      qrImage,
      provider: 'mercadopago',
      gatewayRef: String(data?.id ?? ''),
      expiresAt: data?.date_of_expiration ? new Date(data.date_of_expiration) : undefined,
    };
  }

  /** Confirms a Mercado Pago payment by id (used by the webhook). Returns true if approved. */
  static async isMercadoPagoApproved(paymentId: string): Promise<{ approved: boolean; externalRef?: string }> {
    if (!config.pix.mercadopagoToken) return { approved: false };
    const { data } = await axios.get(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${config.pix.mercadopagoToken}` },
      timeout: 20_000,
    });
    return { approved: data?.status === 'approved', externalRef: data?.external_reference };
  }
}
