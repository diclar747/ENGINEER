import { Response } from 'express';
import axios from 'axios';
import { config } from '../config';
import { prisma } from '../database/prisma';
import { AuthenticatedRequest } from '../security/jwt';
import { AiPromptService } from '../services/ai-prompt.service';
import { VoiceToolsService, VoiceScope, VoiceContext } from '../services/voice-tools.service';

const OPENAI_BASE = 'https://api.openai.com/v1';

/** Preámbulo de voz: cómo tiene que comportarse el agente hablado (va antes del prompt de Bio-Pass). */
function voicePreamble(scope: VoiceScope): string {
  const rol =
    scope === 'doctor'
      ? 'Estás hablando con un DOCTOR del catálogo. Podés mostrarle su agenda y marcar sus citas (atendida / no vino / cancelar).'
      : scope === 'member'
        ? 'Estás hablando con un socio activo de Bio-Pass. Podés ayudarlo a reservar citas, ver sus citas y cancelarlas.'
        : 'Estás hablando con alguien que todavía no se registró. Dale la bienvenida y ayudalo a conocer y registrarse en Bio-Pass. Puede consultar doctores y precios, pero para reservar primero tiene que registrarse.';
  return (
    'Sos el asistente de VOZ de Bio-Pass. Hablás en español rioplatense del Paraguay (si te hablan en guaraní, respondé en guaraní), con frases CORTAS y naturales, como una llamada telefónica. ' +
    'Al empezar, saludá: "¡Bienvenido a Bio-Pass! ¿En qué te puedo ayudar?". ' +
    'Usá las herramientas (tools) para datos reales de doctores, horarios y reservas: nunca inventes doctores, horarios, costos ni confirmaciones. ' +
    'Antes de reservar o cancelar, confirmá en voz alta la fecha y la hora con la persona. No des diagnósticos ni consejos médicos. ' +
    rol
  );
}

/** Resuelve quién habla a partir del JWT (nunca de datos del cliente). */
async function resolveContext(req: AuthenticatedRequest): Promise<{ scope: VoiceScope; ctx: VoiceContext }> {
  const userId = req.user?.userId;
  if (!userId) return { scope: 'guest', ctx: {} };
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, phoneNumber: true } });
  if (!user) return { scope: 'guest', ctx: {} };
  // ¿Es un doctor del catálogo? (su WhatsApp coincide con el número del usuario)
  const digits = (user.phoneNumber || '').replace(/\D/g, '');
  const doctor = digits
    ? await prisma.doctor.findFirst({ where: { active: true, whatsappNumber: digits }, select: { id: true } })
    : null;
  if (doctor) return { scope: 'doctor', ctx: { userId: user.id, doctorId: doctor.id } };
  return { scope: 'member', ctx: { userId: user.id } };
}

export class VoiceController {
  /** Mint de un client secret efímero para que el navegador abra WebRTC con OpenAI Realtime. */
  static async session(req: AuthenticatedRequest, res: Response): Promise<void> {
    if (!config.ai.openaiApiKey) {
      res.status(503).json({ error: 'El agente de voz no está configurado en este momento.' });
      return;
    }
    try {
      const { scope } = await resolveContext(req);
      const promptScope = scope === 'guest' ? 'PRE_REGISTRO' : 'MIEMBRO_ACTIVO';
      const basePrompt = await AiPromptService.getSystemPrompt(promptScope).catch(() => '');
      const instructions = `${voicePreamble(scope)}\n\n${basePrompt}`.slice(0, 12000);

      const body = {
        session: {
          type: 'realtime',
          model: config.ai.realtimeModel,
          audio: { output: { voice: config.ai.realtimeVoice } },
          instructions,
          tools: VoiceToolsService.toolsFor(scope),
          tool_choice: 'auto',
        },
      };
      const { data } = await axios.post(`${OPENAI_BASE}/realtime/client_secrets`, body, {
        headers: {
          Authorization: `Bearer ${config.ai.openaiApiKey}`,
          'Content-Type': 'application/json',
          'OpenAI-Safety-Identifier': `biopass-${req.user?.userId || 'guest'}`,
        },
        timeout: 15000,
      });
      // La key efímera viene en .value (GA). Nunca se loguea ni se devuelve la key real.
      const value = data?.value || data?.client_secret?.value;
      if (!value) {
        res.status(502).json({ error: 'No se pudo iniciar la sesión de voz.' });
        return;
      }
      res.json({ value, model: config.ai.realtimeModel, expiresAt: data?.expires_at, scope });
    } catch (e: any) {
      console.error('[VOICE] session error:', e?.response?.status, e?.response?.data?.error?.message || e?.message);
      res.status(502).json({ error: 'No se pudo iniciar el agente de voz. Probá de nuevo en un momento.' });
    }
  }

  /** Ejecuta una tool pedida por el modelo. La identidad sale del JWT, no de los args. */
  static async tool(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { name, arguments: argsRaw } = req.body || {};
    if (!name || typeof name !== 'string') {
      res.status(400).json({ error: 'Falta el nombre de la tool.' });
      return;
    }
    let args: any = {};
    try {
      args = typeof argsRaw === 'string' ? JSON.parse(argsRaw || '{}') : argsRaw || {};
    } catch {
      args = {};
    }
    const { scope, ctx } = await resolveContext(req);
    // Las tools sensibles (reservar/cancelar/doctor) no se exponen a invitados.
    const allowed = new Set(VoiceToolsService.toolsFor(scope).map((t) => t.name));
    if (!allowed.has(name)) {
      res.status(403).json({ error: 'Esa acción no está disponible para vos.' });
      return;
    }
    const result = await VoiceToolsService.execute(name, args, ctx);
    res.json({ result });
  }
}
