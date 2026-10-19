import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Phone, PhoneOff, Loader2 } from 'lucide-react';
import { api } from '../utils/api';

type Status = 'idle' | 'connecting' | 'live' | 'error';

/**
 * Agente de voz en tiempo real (OpenAI Realtime vía WebRTC).
 * Flujo: el backend mintea un token efímero (POST /voice/session); con él el navegador
 * abre WebRTC directo a OpenAI (mic + audio de vuelta). Cuando el modelo pide una tool,
 * la ejecuta el backend (POST /voice/tool, autorizado por el JWT). Arranca con un toque
 * (los navegadores exigen gesto del usuario para el micrófono y el audio).
 */
export const VoiceAgent: React.FC<{ label?: string }> = ({ label = 'Hablá con Bio-Pass' }) => {
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

  // Ejecuta una tool pedida por el modelo y devuelve el resultado a la sesión.
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
      // 1) micrófono (gesto del usuario)
      const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
      micRef.current = mic;

      // 2) token efímero del backend (lleva el JWT si el usuario está logueado)
      const { data } = await api.post('/voice/session', {});
      const ephemeral: string = data?.value;
      const model: string = data?.model;
      if (!ephemeral) throw new Error('no-ephemeral');

      // 3) WebRTC
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
      dc.onopen = () => {
        setStatus('live');
        // Pedir que arranque saludando (el saludo va en las instructions del server).
        try { dc.send(JSON.stringify({ type: 'response.create' })); } catch {}
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const sdpRes = await fetch(`https://api.openai.com/v1/realtime/calls${model ? `?model=${encodeURIComponent(model)}` : ''}`, {
        method: 'POST',
        body: offer.sdp,
        headers: { Authorization: `Bearer ${ephemeral}`, 'Content-Type': 'application/sdp' },
      });
      if (!sdpRes.ok) throw new Error('sdp-' + sdpRes.status);
      const answer = { type: 'answer' as const, sdp: await sdpRes.text() };
      await pc.setRemoteDescription(answer);
    } catch (e: any) {
      cleanup();
      setStatus('error');
      setErrMsg(
        e?.name === 'NotAllowedError'
          ? 'Necesito permiso del micrófono para hablar.'
          : e?.response?.status === 503
            ? 'El agente de voz todavía no está configurado.'
            : 'No se pudo conectar. Probá de nuevo.'
      );
    }
  }, [status, onEvent, cleanup, hangup]);

  const live = status === 'live';
  const connecting = status === 'connecting';
  const active = speaking || listening;
  // Superficie "vidrio líquido" del orbe (azul→verde, como una esfera iluminada).
  const orbSurface: React.CSSProperties = {
    background:
      'radial-gradient(circle at 32% 26%, #9af7dc 0%, #35e0c6 26%, #1aa6d8 58%, #0f6fb8 86%, #0a4f93 100%)',
  };
  const glowColor = speaking ? 'rgba(56,189,248,0.55)' : listening ? 'rgba(52,211,153,0.55)' : 'rgba(45,212,191,0.4)';

  return (
    <div className="fixed bottom-6 left-6 z-40 flex flex-col items-start gap-3 select-none">
      <style>{`
        @keyframes bp-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}
        @keyframes bp-spin{to{transform:rotate(360deg)}}
        @keyframes bp-halo{0%{transform:scale(1);opacity:.55}100%{transform:scale(2.1);opacity:0}}
        @keyframes bp-eq{0%,100%{transform:scaleY(.35)}50%{transform:scaleY(1)}}
        @keyframes bp-rise{from{opacity:0;transform:translateY(8px) scale(.96)}to{opacity:1;transform:none}}
      `}</style>
      <audio ref={audioRef} autoPlay />

      {errMsg && (
        <div className="max-w-[240px] text-[11px] font-semibold text-rose-600 dark:text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-xl px-3 py-1.5 backdrop-blur" style={{ animation: 'bp-rise .25s ease' }}>
          {errMsg}
        </div>
      )}

      {(live || connecting) && (
        <div
          className="flex items-center gap-2.5 rounded-2xl border border-white/15 bg-panel/80 dark:bg-black/40 px-3.5 py-2 shadow-xl backdrop-blur-md"
          style={{ animation: 'bp-rise .3s ease' }}
        >
          {/* Ecualizador animado mientras habla, barras quietas si escucha */}
          <div className="flex items-end gap-[3px] h-5">
            {[0, 1, 2, 3, 4].map((i) => (
              <span
                key={i}
                className="w-[3px] rounded-full"
                style={{
                  height: '100%',
                  transformOrigin: 'bottom',
                  background: speaking ? 'linear-gradient(#38bdf8,#2dd4bf)' : listening ? '#34d399' : 'var(--fg-muted, #94a3b8)',
                  animation: speaking ? `bp-eq ${0.6 + i * 0.12}s ease-in-out ${i * 0.08}s infinite` : 'none',
                  transform: speaking ? undefined : `scaleY(${listening ? 0.6 : 0.35})`,
                }}
              />
            ))}
          </div>
          <span className="text-[12px] font-bold text-fg">
            {connecting ? 'Conectando…' : speaking ? 'Bio-Pass está hablando…' : listening ? 'Te escucho…' : 'En línea'}
          </span>
        </div>
      )}

      <button
        onClick={live || connecting ? hangup : start}
        title={live ? 'Cortar llamada' : label}
        aria-label={live ? 'Cortar llamada' : label}
        className="relative w-[72px] h-[72px] rounded-full grid place-items-center outline-none focus-visible:ring-4 focus-visible:ring-sky-400/50"
        style={{ animation: active ? undefined : 'bp-float 4s ease-in-out infinite' }}
      >
        {/* Glow exterior suave */}
        <span className="absolute -inset-3 rounded-full blur-xl transition-all" style={{ background: glowColor, opacity: active ? 0.9 : 0.6 }} />
        {/* Halos expansivos cuando está activo */}
        {active && (
          <>
            <span className="absolute inset-0 rounded-full" style={{ background: glowColor, animation: 'bp-halo 1.8s ease-out infinite' }} />
            <span className="absolute inset-0 rounded-full" style={{ background: glowColor, animation: 'bp-halo 1.8s ease-out .9s infinite' }} />
          </>
        )}
        {/* Esfera */}
        <span className="relative w-full h-full rounded-full shadow-2xl grid place-items-center overflow-hidden" style={orbSurface}>
          {/* Brillo especular + anillo interno de vidrio */}
          <span className="absolute inset-0 rounded-full" style={{ background: 'radial-gradient(circle at 34% 24%, rgba(255,255,255,.75) 0%, rgba(255,255,255,0) 38%)' }} />
          <span className="absolute inset-[6px] rounded-full border border-white/25" />
          {connecting ? (
            <Loader2 className="relative w-7 h-7 text-white animate-spin drop-shadow" />
          ) : live ? (
            <PhoneOff className="relative w-7 h-7 text-white drop-shadow" />
          ) : (
            <Phone className="relative w-7 h-7 text-white drop-shadow" />
          )}
        </span>
        {/* Puntito "llamar" estilo la referencia, en reposo */}
        {status === 'idle' && (
          <span className="absolute -bottom-0.5 -right-0.5 w-6 h-6 rounded-full bg-white grid place-items-center shadow-md">
            <Phone className="w-3 h-3 text-teal-600" />
          </span>
        )}
      </button>
      {status === 'idle' && <span className="text-[11px] font-bold text-fg-muted pl-1">{label}</span>}
    </div>
  );
};
