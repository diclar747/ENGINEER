import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Phone, PhoneOff } from 'lucide-react';
import { api } from '../utils/api';

type Status = 'idle' | 'connecting' | 'live' | 'error';

/** Abre el agente de voz desde cualquier parte (ej. el botón del compositor de /registro). */
export function openVoiceAgent() {
  window.dispatchEvent(new CustomEvent('biopass:voice-open'));
}

/**
 * Agente de voz en tiempo real (OpenAI Realtime vía WebRTC).
 * Al iniciar abre un POPUP con el orbe girando y conversa por voz. El backend mintea un
 * token efímero (/voice/session); con él el navegador abre WebRTC directo a OpenAI. Cuando
 * el modelo pide una tool, la ejecuta el backend (/voice/tool, autorizado por el JWT).
 * `floating`: muestra el orbe-lanzador flotante en la esquina (true por defecto). Con false,
 * solo se abre desde openVoiceAgent() (p. ej. el botón del micrófono del chat).
 */
export const VoiceAgent: React.FC<{ label?: string; floating?: boolean }> = ({ label = 'Hablá con Bio-Pass', floating = true }) => {
  const [status, setStatus] = useState<Status>('idle');
  const [speaking, setSpeaking] = useState(false);
  const [listening, setListening] = useState(false);
  const [errMsg, setErrMsg] = useState('');

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const cleanup = useCallback(() => {
    try { dcRef.current?.close(); } catch {}
    try { pcRef.current?.getSenders().forEach((s) => s.track?.stop()); } catch {}
    try { pcRef.current?.close(); } catch {}
    try { micRef.current?.getTracks().forEach((t) => t.stop()); } catch {}
    dcRef.current = null; pcRef.current = null; micRef.current = null;
    setSpeaking(false); setListening(false);
  }, []);

  useEffect(() => () => cleanup(), [cleanup]);
  const hangup = useCallback(() => { cleanup(); setStatus('idle'); }, [cleanup]);

  const runTool = useCallback(async (call_id: string, name: string, argStr: string) => {
    const dc = dcRef.current;
    if (!dc) return;
    let result: any;
    try {
      const { data } = await api.post('/voice/tool', { name, arguments: argStr });
      result = data?.result ?? { error: 'Sin resultado.' };
    } catch (e: any) {
      result = { error: e?.response?.data?.error || 'No se pudo ejecutar la acción.' };
    }
    try {
      dc.send(JSON.stringify({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id, output: JSON.stringify(result) } }));
      dc.send(JSON.stringify({ type: 'response.create' }));
    } catch {}
  }, []);

  const onEvent = useCallback((ev: MessageEvent) => {
    let msg: any;
    try { msg = JSON.parse(ev.data); } catch { return; }
    switch (msg.type) {
      case 'input_audio_buffer.speech_started': setListening(true); break;
      case 'input_audio_buffer.speech_stopped': setListening(false); break;
      case 'response.created': setSpeaking(true); break;
      case 'response.done': setSpeaking(false); break;
      case 'response.function_call_arguments.done':
        if (msg.call_id && msg.name) runTool(msg.call_id, msg.name, msg.arguments || '{}');
        break;
      default: break;
    }
  }, [runTool]);

  const start = useCallback(async () => {
    if (status === 'connecting' || status === 'live') return;
    setErrMsg(''); setStatus('connecting');
    try {
      const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
      micRef.current = mic;
      const { data } = await api.post('/voice/session', {});
      const ephemeral: string = data?.value;
      const model: string = data?.model;
      if (!ephemeral) throw new Error('no-ephemeral');

      const pc = new RTCPeerConnection();
      pcRef.current = pc;
      pc.ontrack = (e) => { if (audioRef.current) audioRef.current.srcObject = e.streams[0]; };
      pc.oniceconnectionstatechange = () => {
        const st = pc.iceConnectionState;
        if (st === 'failed' || st === 'disconnected' || st === 'closed') hangup();
      };
      mic.getTracks().forEach((t) => pc.addTrack(t, mic));

      const dc = pc.createDataChannel('oai-events');
      dcRef.current = dc;
      dc.onmessage = onEvent;
      dc.onopen = () => { setStatus('live'); try { dc.send(JSON.stringify({ type: 'response.create' })); } catch {} };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const sdpRes = await fetch(`https://api.openai.com/v1/realtime/calls${model ? `?model=${encodeURIComponent(model)}` : ''}`, {
        method: 'POST', body: offer.sdp, headers: { Authorization: `Bearer ${ephemeral}`, 'Content-Type': 'application/sdp' },
      });
      if (!sdpRes.ok) throw new Error('sdp-' + sdpRes.status);
      await pc.setRemoteDescription({ type: 'answer', sdp: await sdpRes.text() });
    } catch (e: any) {
      cleanup();
      setStatus('error');
      setErrMsg(
        e?.name === 'NotAllowedError' ? 'Necesito permiso del micrófono para hablar.'
          : e?.response?.status === 503 ? 'El agente de voz todavía no está configurado.'
            : 'No se pudo conectar. Probá de nuevo.'
      );
    }
  }, [status, onEvent, cleanup, hangup]);

  // Permite abrirlo desde el botón del compositor (openVoiceAgent()).
  useEffect(() => {
    const h = () => start();
    window.addEventListener('biopass:voice-open', h);
    return () => window.removeEventListener('biopass:voice-open', h);
  }, [start]);

  const live = status === 'live';
  const connecting = status === 'connecting';
  const open = live || connecting;
  const active = speaking || listening;
  const glow = speaking ? 'rgba(56,189,248,.6)' : listening ? 'rgba(52,211,153,.6)' : 'rgba(45,212,191,.5)';
  const orbSurface: React.CSSProperties = {
    background: 'radial-gradient(circle at 32% 26%, #9af7dc 0%, #35e0c6 26%, #1aa6d8 58%, #0f6fb8 86%, #0a4f93 100%)',
  };

  return (
    <>
      <style>{`
        @keyframes bp-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}
        @keyframes bp-spin{to{transform:rotate(360deg)}}
        @keyframes bp-halo{0%{transform:scale(1);opacity:.55}100%{transform:scale(2.1);opacity:0}}
        @keyframes bp-rise{from{opacity:0;transform:translateY(10px) scale(.96)}to{opacity:1;transform:none}}
      `}</style>
      <audio ref={audioRef} autoPlay />

      {/* ───── Panel de llamada en la esquina (NO bloquea el chat: se puede seguir escribiendo) ───── */}
      {open && (
        <div className="fixed right-5 bottom-24 sm:right-6 sm:bottom-6 z-50 select-none" style={{ animation: 'bp-rise .25s ease' }}>
          <div className="flex flex-col items-center gap-3 rounded-3xl border border-line bg-panel/95 dark:bg-black/60 px-5 py-4 shadow-2xl backdrop-blur-md w-[178px]">
            <div className="relative w-[92px] h-[92px] grid place-items-center">
              <span className="absolute -inset-4 rounded-full blur-xl transition-all" style={{ background: glow, opacity: active ? 1 : .7 }} />
              {active && (<>
                <span className="absolute inset-0 rounded-full" style={{ background: glow, animation: 'bp-halo 1.9s ease-out infinite' }} />
                <span className="absolute inset-0 rounded-full" style={{ background: glow, animation: 'bp-halo 1.9s ease-out .95s infinite' }} />
              </>)}
              <span className="relative w-full h-full rounded-full overflow-hidden shadow-xl" style={orbSurface}>
                {/* "mundo girando": barrido cónico de luz girando */}
                <span className="absolute inset-0 rounded-full" style={{ background: 'conic-gradient(from 0deg, rgba(255,255,255,0), rgba(255,255,255,.20), rgba(255,255,255,0) 55%)', animation: 'bp-spin 7s linear infinite' }} />
                <span className="absolute inset-0 rounded-full" style={{ background: 'radial-gradient(circle at 34% 24%, rgba(255,255,255,.72) 0%, rgba(255,255,255,0) 42%)' }} />
                <span className="absolute inset-[8px] rounded-full border border-white/25" />
              </span>
            </div>
            <div className="text-center">
              <div className="text-[13px] font-black text-fg leading-tight">{connecting ? 'Conectando…' : speaking ? 'Bio-Pass habla…' : listening ? 'Te escucho…' : 'En línea'}</div>
              <div className="text-[10px] text-fg-muted mt-0.5 leading-snug">Podés seguir escribiendo mientras hablás</div>
            </div>
            {errMsg && <div className="text-[11px] text-rose-500 text-center">{errMsg}</div>}
            <button onClick={hangup} aria-label="Cortar" className="w-12 h-12 rounded-full bg-gradient-to-br from-rose-500 to-rose-600 text-white grid place-items-center shadow-lg hover:scale-105 transition">
              <PhoneOff className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}

      {/* Toast de error cuando no hay popup abierto (p.ej. lanzado desde el micro y falló) */}
      {errMsg && !open && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 max-w-[300px] text-center text-[12px] font-semibold text-rose-600 dark:text-rose-200 bg-rose-500/10 border border-rose-500/25 rounded-xl px-3 py-2 backdrop-blur" style={{ animation: 'bp-rise .25s ease' }}>
          {errMsg}
        </div>
      )}

      {/* ───── Orbe-lanzador flotante (esquina) ───── */}
      {floating && !open && (
        <div className="fixed right-5 bottom-24 sm:right-6 sm:bottom-6 z-40 flex flex-col items-end gap-2 select-none">
          <button
            onClick={start}
            title={label} aria-label={label}
            className="relative w-[72px] h-[72px] rounded-full grid place-items-center outline-none focus-visible:ring-4 focus-visible:ring-sky-400/50"
            style={{ animation: 'bp-float 4s ease-in-out infinite' }}
          >
            <span className="absolute -inset-3 rounded-full blur-xl" style={{ background: 'rgba(45,212,191,.45)', opacity: .6 }} />
            <span className="relative w-full h-full rounded-full shadow-2xl grid place-items-center overflow-hidden" style={orbSurface}>
              <span className="absolute inset-0 rounded-full" style={{ background: 'radial-gradient(circle at 34% 24%, rgba(255,255,255,.75) 0%, rgba(255,255,255,0) 38%)' }} />
              <span className="absolute inset-[6px] rounded-full border border-white/25" />
              <Phone className="relative w-7 h-7 text-white drop-shadow" />
            </span>
            <span className="absolute -bottom-0.5 -right-0.5 w-6 h-6 rounded-full bg-white grid place-items-center shadow-md">
              <Phone className="w-3 h-3 text-teal-600" />
            </span>
          </button>
          <span className="text-[11px] font-bold text-fg-muted pr-1">{label}</span>
        </div>
      )}
    </>
  );
};
