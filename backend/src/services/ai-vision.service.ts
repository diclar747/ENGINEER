import axios from 'axios';
import { config } from '../config';
import { NiroService } from './niro.service';

/**
 * Thin wrapper over OpenAI / Gemini vision models. Returns parsed JSON from the
 * model or null when no provider is configured or the call fails — callers must
 * always have a non-AI fallback (OCR + heuristics).
 */
export class AiVisionService {
  static get provider(): 'openai' | 'gemini' | 'niro' | 'none' {
    return config.ai.provider;
  }

  static get available(): boolean {
    return this.provider !== 'none';
  }

  /**
   * Sends an image + instruction and asks the model to reply with a single JSON object.
   * `schemaHint` is a short description of the expected shape.
   */
  static async extractJson(
    imageBuffer: Buffer,
    mimeType: string,
    instruction: string
  ): Promise<Record<string, any> | null> {
    const provider = this.provider;
    if (provider === 'none') return null;

    if (provider === 'niro') {
      const ext = mimeType.includes('png') ? 'png' : mimeType.includes('pdf') ? 'pdf' : 'jpg';
      const res = await NiroService.visionExtract(imageBuffer, `documento.${ext}`, {
        question:
          instruction +
          '\n\nRespondé ÚNICAMENTE con un objeto JSON válido, sin markdown ni texto extra.',
      });
      if (!res) return null;
      if (res.data && typeof res.data === 'object') return res.data as Record<string, any>;
      return this.parseJson(res.text);
    }

    const b64 = imageBuffer.toString('base64');

    try {
      const raw =
        provider === 'openai'
          ? await this.callOpenAI(b64, mimeType, instruction)
          : await this.callGemini(b64, mimeType, instruction);
      return this.parseJson(raw);
    } catch (err: any) {
      console.warn(`[ai-vision:${provider}] failed:`, err?.response?.data?.error?.message || err?.message || err);
      return null;
    }
  }

  private static async callOpenAI(b64: string, mimeType: string, instruction: string): Promise<string> {
    const { data } = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: config.ai.openaiModel,
        messages: [
          {
            role: 'system',
            content:
              'Sos un extractor de datos. Respondé SIEMPRE con un único objeto JSON válido, sin texto extra, sin markdown.',
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: instruction },
              { type: 'image_url', image_url: { url: `data:${mimeType};base64,${b64}` } },
            ],
          },
        ],
        max_tokens: 700,
        temperature: 0,
        response_format: { type: 'json_object' },
      },
      { headers: { Authorization: `Bearer ${config.ai.openaiApiKey}` }, timeout: 45_000 }
    );
    return data?.choices?.[0]?.message?.content ?? '';
  }

  private static async callGemini(b64: string, mimeType: string, instruction: string): Promise<string> {
    const { data } = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/${config.ai.geminiModel}:generateContent?key=${config.ai.geminiApiKey}`,
      {
        contents: [
          {
            parts: [
              { text: `${instruction}\n\nRespondé SOLO con un objeto JSON válido, sin markdown.` },
              { inline_data: { mime_type: mimeType, data: b64 } },
            ],
          },
        ],
        generationConfig: { temperature: 0, maxOutputTokens: 700, responseMimeType: 'application/json' },
      },
      { timeout: 45_000 }
    );
    return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  }

  private static parseJson(raw: string): Record<string, any> | null {
    if (!raw) return null;
    const cleaned = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    try {
      return JSON.parse(cleaned);
    } catch {
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          return JSON.parse(match[0]);
        } catch {
          /* fall through */
        }
      }
      return null;
    }
  }
}
