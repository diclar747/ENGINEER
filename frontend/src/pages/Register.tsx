import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import {
  Send,
  Loader2,
  HeartPulse,
  Paperclip,
  Camera,
  Mic,
  X,
  CheckCircle2,
  ArrowRight,
  ArrowLeft,
  BellRing,
} from 'lucide-react';
import { API_BASE_URL } from '../utils/api';
import { renderFormattedText } from '../utils/textFormat';
import { getPushState, subscribeToPush } from '../utils/push';

interface Msg {
  id: string;
  who: 'bot' | 'me';
  text?: string;
  imageUrl?: string;
  fileName?: string;
}

const STEPS: { keys: string[]; label: string }[] = [
  { keys: ['STEP1_WELCOME', 'UNREGISTERED'], label: 'Idioma' },
  { keys: ['STEP2_DOCUMENT', 'STEP2_CONFIRM_CI'], label: 'Identidad' },
  { keys: ['STEP3_CONTACT'], label: 'Contacto de emergencia' },
  { keys: ['STEP4_ADDRESS'], label: 'Domicilio' },
  { keys: ['STEP5_EMAIL'], label: 'Correo' },
  { keys: ['STEP6_CONDITIONS'], label: 'Datos médicos' },
  { keys: ['STEP7_PIN'], label: 'PIN de seguridad' },
  { keys: ['STEP8_PAYMENT'], label: 'Plan y pago' },
  { keys: ['AWAITING_PAYMENT_CONFIRMATION'], label: 'Confirmación de pago' },
];

const stepIndex = (state: string) => {
  const i = STEPS.findIndex((s) => s.keys.includes(state));
  if (i !== -1) return i;
  return state === 'ACTIVE' || state === 'ACTIVE_MEMBER' ? STEPS.length : 0;
};

const now = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** Si ya hay una sesión (vino del FAB del dashboard, no de afuera sin cuenta),
 *  se conoce el teléfono — se precarga para no hacerlo re-tipear el suyo propio. */
function knownPhone(): string {
  try {
    const raw = localStorage.getItem('biopass_user');
    const u = raw ? JSON.parse(raw) : null;
    return u?.phoneNumber ? String(u.phoneNumber) : '';
  } catch {
    return '';
  }
}

export const Register: React.FC = () => {
  const navigate = useNavigate();
  const [phone, setPhone] = useState(knownPhone);
  const [started, setStarted] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState('STEP1_WELCOME');
  const [done, setDone] = useState(false);
  const [returningMember, setReturningMember] = useState(false);
  const [staged, setStaged] = useState<{ file: File; previewUrl?: string } | null>(null);

  const [recording, setRecording] = useState(false);
  const [recordSecs, setRecordSecs] = useState(0);

  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Este chat también es el "Asistente Bot" del nav (público Y logueado) — muchos
  // de los que entran acá ya son socios activos que quieren preguntar algo (no
  // registrarse). Si ya venían activos ANTES del primer mensaje, no es un
  // "registro recién completado": seguimos la conversación como WhatsApp en vez
  // de cortar con la pantalla de "¡listo!". OJO: antes esto se decidía mirando
  // si era "el primer mensaje de la sesión" — pero un socio existente que manda
  // un SEGUNDO mensaje también sigue teniendo `completed=true` (su cuenta sigue
  // activa), y esa lógica lo mandaba igual a la pantalla de cierre. Ahora se fija
  // el estado de la cuenta UNA sola vez, en el primer reply, y ya no cambia.
  const accountStatusRef = useRef<'unknown' | 'was-active' | 'was-registering'>('unknown');
  // ¿Ya había sesión (vino del FAB del dashboard, no de afuera)? Si es así, los
  // botones de "ya tenés cuenta" van al panel, no a pedir loguearse de nuevo.
  const isLoggedIn = !!localStorage.getItem('biopass_token');

  // Primer paso ANTES del formulario de teléfono: pedir el permiso de
  // notificaciones. 'checking' evita el parpadeo mientras se consulta el
  // estado; si ya estaba decidido (aceptado/bloqueado antes, o no soportado),
  // se salta solo — no hay nada que preguntar de nuevo.
  const [pushGate, setPushGate] = useState<'checking' | 'show' | 'done'>('checking');
  const [pushBusy, setPushBusy] = useState(false);
  useEffect(() => {
    getPushState()
      .then((s) => setPushGate(s === 'default' ? 'show' : 'done'))
      .catch(() => setPushGate('done'));
  }, []);
  const decidePush = async (accept: boolean) => {
    if (accept) {
      setPushBusy(true);
      try {
        await subscribeToPush();
      } finally {
        setPushBusy(false);
      }
    }
    setPushGate('done');
  };

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy, staged]);

  const post = useCallback(
    async (message: string, file?: File, replaceId?: string) => {
      setBusy(true);
      try {
        const fd = new FormData();
        fd.append('phoneNumber', phone.replace(/[^0-9]/g, ''));
        fd.append('message', message);
        if (file) fd.append('media', file, file.name);
        const { data } = await axios.post(`${API_BASE_URL}/auth/register-step`, fd);
        // Nota de voz: reemplaza el "🎤 Nota de voz…" provisorio por lo que el
        // servidor transcribió, para que confirme que se entendió bien.
        if (replaceId) {
          setMessages((p) =>
            p.map((m) => (m.id === replaceId ? { ...m, text: data.transcript ? `🎤 "${data.transcript}"` : '🎤 Nota de voz' } : m))
          );
        }
        setMessages((p) => [
          ...p,
          { id: `b-${Date.now()}`, who: 'bot', text: data.reply, imageUrl: data.mediaAttachment?.dataUrl },
        ]);
        if (data.state) setState(data.state);
        // El estado de la cuenta (¿ya estaba activa, o se estaba registrando?) se
        // fija UNA sola vez con el primer reply y ya no cambia — así un socio
        // existente puede mandar cuantos mensajes quiera sin que de repente
        // aparezca la pantalla de "¡registro completo!".
        if (accountStatusRef.current === 'unknown') {
          accountStatusRef.current = data.completed ? 'was-active' : 'was-registering';
          if (data.completed) setReturningMember(true);
        } else if (data.completed && accountStatusRef.current === 'was-registering') {
          accountStatusRef.current = 'was-active'; // no repetir la pantalla de cierre en mensajes futuros
          setDone(true); // el login que sigue liga la suscripción anónima a esta cuenta (ver Login.tsx)
        }
      } catch (err: any) {
        setMessages((p) => [
          ...p,
          {
            id: `e-${Date.now()}`,
            who: 'bot',
            text: err?.response?.data?.error || '⚠️ Error de conexión. Probá de nuevo.',
          },
        ]);
      } finally {
        setBusy(false);
      }
    },
    [phone],
  );

  const begin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (phone.replace(/[^0-9]/g, '').length < 7) return;
    setStarted(true);
    await post('hola');
  };

  const send = async () => {
    const text = input.trim();
    const file = staged?.file;
    if ((!text && !file) || busy) return;
    setMessages((p) => [
      ...p,
      {
        id: `m-${Date.now()}`,
        who: 'me',
        text: text || undefined,
        imageUrl: file && file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined,
        fileName: file && !file.type.startsWith('image/') ? file.name : undefined,
      },
    ]);
    setInput('');
    setStaged(null);
    await post(text, file);
  };

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setStaged({ file: f, previewUrl: f.type.startsWith('image/') ? URL.createObjectURL(f) : undefined });
  };

  // Nota de voz: mismo camino que WhatsApp — el backend ya transcribe cualquier
  // /auth/register-step con `media` de mimetype audio/* (NiroService.transcribeAudio)
  // y lo trata como si hubiera sido tecleado. Acá solo falta grabarla y mandarla.
  const stopRecordTimer = () => {
    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
  };

  const sendAudio = async (file: File) => {
    const id = `m-${Date.now()}`;
    setMessages((p) => [...p, { id, who: 'me', text: '🎤 Nota de voz…' }]);
    await post('', file, id);
  };

  const startRecording = async () => {
    if (busy || recording) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setMessages((p) => [
        ...p,
        { id: `e-${Date.now()}`, who: 'bot', text: '⚠️ Tu navegador no permite grabar audio acá. Escribí tu respuesta.' },
      ]);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/mp4')
          ? 'audio/mp4'
          : '';
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      audioChunksRef.current = [];
      recordedStreamRef.current = stream;
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        recordedStreamRef.current?.getTracks().forEach((t) => t.stop());
        recordedStreamRef.current = null;
        if (audioChunksRef.current.length) {
          const blob = new Blob(audioChunksRef.current, { type: rec.mimeType || 'audio/webm' });
          const ext = (rec.mimeType || '').includes('mp4') ? 'm4a' : 'webm';
          sendAudio(new File([blob], `nota_voz.${ext}`, { type: blob.type }));
        }
      };
      rec.start();
      mediaRecorderRef.current = rec;
      setRecording(true);
      setRecordSecs(0);
      recordTimerRef.current = setInterval(() => setRecordSecs((s) => s + 1), 1000);
    } catch {
      setMessages((p) => [
        ...p,
        { id: `e-${Date.now()}`, who: 'bot', text: '⚠️ No pude acceder al micrófono. Revisá los permisos del navegador.' },
      ]);
    }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    setRecording(false);
    stopRecordTimer();
  };

  const cancelRecording = () => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.onstop = null; // no auto-enviar
      mediaRecorderRef.current.stop();
    }
    recordedStreamRef.current?.getTracks().forEach((t) => t.stop());
    recordedStreamRef.current = null;
    audioChunksRef.current = [];
    setRecording(false);
    stopRecordTimer();
  };

  useEffect(() => () => stopRecordTimer(), []);

  const idx = stepIndex(state);
  const pct = done ? 100 : Math.round((idx / STEPS.length) * 100);

  return (
    // En pantallas anchas, el chat queda como una columna centrada tipo "WhatsApp
    // Web" (no estirado de punta a punta) — en el teléfono sigue de borde a borde.
    <div className="fixed inset-0 flex justify-center bg-app sm:bg-muted/40">
    <div className="w-full sm:max-w-2xl h-full flex flex-col bg-app text-fg sm:border-x sm:border-line sm:shadow-xl">
      {/* Header */}
      <header
        className="shrink-0 bg-card border-b border-line"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <div className="flex items-center gap-2.5 px-3 py-2.5">
          <button
            onClick={() => (started ? window.location.reload() : navigate(isLoggedIn ? '/dashboard' : '/login'))}
            className="p-1.5 -ml-1 rounded-full hover:bg-muted text-fg-soft shrink-0"
            aria-label="Volver"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-teal-500 to-cyan-400 p-0.5 shrink-0">
            <div className="w-full h-full bg-card rounded-[9px] flex items-center justify-center">
              <HeartPulse className="w-5 h-5 text-teal-500" />
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-[15px] font-bold leading-tight truncate">
              {returningMember ? 'Asistente Bio-Pass' : 'Crear mi Bio-Pass'}
            </h1>
            <p className="text-[11px] text-fg-muted leading-tight">
              {pushGate === 'show'
                ? 'Paso 1 · Notificaciones'
                : done
                  ? '¡Registro completo!'
                  : returningMember
                    ? 'Ya sos socio activo — preguntame lo que necesites'
                    : started
                      ? `Paso ${Math.min(idx + 1, STEPS.length)}/${STEPS.length} · ${STEPS[Math.min(idx, STEPS.length - 1)].label}`
                      : 'Registro guiado · < 3 min'}
            </p>
          </div>
        </div>
        {started && !returningMember && pushGate === 'done' && (
          <div className="h-1 bg-muted">
            <div
              className="h-full bg-gradient-to-r from-teal-600 to-emerald-600 transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
        )}
      </header>

      {pushGate === 'checking' ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-teal-500" />
        </div>
      ) : pushGate === 'show' ? (
        /* Paso 1, ANTES de pedir el teléfono: notificaciones. */
        <div className="flex-1 overflow-y-auto flex items-center justify-center p-6">
          <div className="w-full max-w-sm text-center space-y-5">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-teal-500 to-emerald-500 flex items-center justify-center mx-auto shadow-lg shadow-teal-500/30">
              <BellRing className="w-8 h-8 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-black tracking-tight">Activá las notificaciones</h2>
              <p className="text-xs text-fg-muted mt-1.5 leading-relaxed">
                Te avisamos al instante en este dispositivo cuando alguien escanee tu QR de emergencia,
                cuando toca tu medicación o se acerca un turno — además del aviso por WhatsApp.
              </p>
            </div>
            <div className="space-y-2">
              <button
                onClick={() => decidePush(true)}
                disabled={pushBusy}
                className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 disabled:opacity-50 text-white font-black text-sm shadow-lg shadow-teal-500/20 transition-all active:scale-[0.98]"
              >
                {pushBusy ? 'Activando…' : 'Activar notificaciones'}
              </button>
              <button
                onClick={() => decidePush(false)}
                disabled={pushBusy}
                className="w-full py-2.5 rounded-2xl text-fg-muted hover:text-fg text-xs font-semibold transition-colors"
              >
                Ahora no, continuar
              </button>
            </div>
          </div>
        </div>
      ) : !started ? (
        /* Phone number — first screen */
        <div className="flex-1 overflow-y-auto flex items-center justify-center p-6">
          <form onSubmit={begin} className="w-full max-w-sm space-y-5">
            <div className="text-center">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-teal-500 to-cyan-400 p-0.5 mx-auto mb-3">
                <div className="w-full h-full bg-card rounded-[14px] flex items-center justify-center">
                  <HeartPulse className="w-8 h-8 text-teal-500" />
                </div>
              </div>
              <h2 className="text-xl font-black tracking-tight">Empecemos</h2>
              <p className="text-xs text-fg-muted mt-1">
                Tu número va a ser tu usuario para entrar, junto al PIN que elijas ahora.
              </p>
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-fg-soft mb-1.5">
                Número de celular (WhatsApp)
              </label>
              <input
                type="tel"
                inputMode="numeric"
                autoFocus
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="595981123456"
                className="w-full px-4 py-3.5 bg-panel border border-line rounded-2xl text-base font-mono text-fg placeholder-fg-muted focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 outline-none transition-all"
              />
              <p className="mt-1.5 text-[11px] text-fg-muted">Formato internacional (Paraguay: 595…, Brasil: 55…).</p>
            </div>
            <button
              type="submit"
              disabled={phone.replace(/[^0-9]/g, '').length < 7}
              className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 text-white font-black text-sm shadow-lg shadow-teal-500/20 flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:opacity-50"
            >
              Empezar registro <ArrowRight className="w-4 h-4" />
            </button>
            {!isLoggedIn && (
              <p className="text-center text-[11px] text-fg-muted">
                ¿Ya tenés cuenta?{' '}
                <button type="button" onClick={() => navigate('/login')} className="text-teal-600 dark:text-teal-300 font-semibold">
                  Iniciar sesión
                </button>
              </p>
            )}
          </form>
        </div>
      ) : (
        <>
          {returningMember && (
            <div className="shrink-0 px-3.5 py-2 bg-teal-500/10 border-b border-teal-500/20 text-[11px] text-fg-soft flex items-center justify-between gap-2">
              <span>
                {isLoggedIn
                  ? 'Ya sos socio activo — para pagos, descargas e historial completo, andá a tu panel.'
                  : 'Ya tenés una cuenta activa — para gestionarla completa (pagos, descargas, historial), entrá a tu panel.'}
              </span>
              <button
                onClick={() => navigate(isLoggedIn ? '/dashboard' : '/login')}
                className="shrink-0 font-bold text-teal-600 dark:text-teal-300 whitespace-nowrap"
              >
                {isLoggedIn ? 'Ir a mi panel' : 'Iniciar sesión'}
              </button>
            </div>
          )}
          {/* Chat */}
          <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-3 py-4 space-y-2.5">
            {messages.map((m) => (
              <div key={m.id} className={`flex ${m.who === 'me' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[15px] leading-relaxed break-words shadow-sm ${
                    m.who === 'me'
                      ? 'bg-teal-600 text-white rounded-br-md'
                      : 'bg-card border border-line text-fg rounded-bl-md'
                  }`}
                >
                  {m.imageUrl && <img src={m.imageUrl} alt="" className="rounded-xl mb-1.5 max-h-56 w-auto" />}
                  {m.fileName && <div className="text-[13px] opacity-80 mb-1">📎 {m.fileName}</div>}
                  {m.text && <div>{renderFormattedText(m.text)}</div>}
                  <div className={`mt-1 text-[10px] ${m.who === 'me' ? 'text-white/60' : 'text-fg-muted'} text-right`}>
                    {now()}
                  </div>
                </div>
              </div>
            ))}
            {busy && (
              <div className="flex justify-start">
                <div className="bg-card border border-line text-fg-muted rounded-2xl rounded-bl-md px-4 py-2.5 text-sm flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" /> procesando…
                </div>
              </div>
            )}
          </div>

          {done ? (
            <div
              className="shrink-0 p-4 border-t border-line bg-emerald-500/10"
              style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}
            >
              <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-300 font-bold text-sm mb-2.5">
                <CheckCircle2 className="w-5 h-5" /> ¡Tu Bio-Pass está activo!
              </div>
              <button
                onClick={() => navigate('/login')}
                className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-teal-600 to-emerald-600 text-white font-black text-sm flex items-center justify-center gap-2"
              >
                Ir a iniciar sesión <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div
              className="shrink-0 border-t border-line bg-card"
              style={{ paddingBottom: 'calc(0.5rem + env(safe-area-inset-bottom))' }}
            >
              {staged && (
                <div className="px-3 pt-2.5">
                  <div className="flex items-center gap-2.5 bg-panel rounded-xl p-2">
                    {staged.previewUrl ? (
                      <img src={staged.previewUrl} alt="" className="w-12 h-12 rounded-lg object-cover" />
                    ) : (
                      <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center text-lg">📎</div>
                    )}
                    <span className="text-xs text-fg-soft flex-1 truncate">{staged.file.name}</span>
                    <button onClick={() => setStaged(null)} className="p-1.5 hover:bg-muted rounded-full" aria-label="Quitar">
                      <X className="w-4 h-4 text-fg-muted" />
                    </button>
                  </div>
                </div>
              )}
              {recording ? (
                <div className="px-3 pt-2 pb-1.5 flex items-center gap-3">
                  <button
                    onClick={cancelRecording}
                    className="w-10 h-10 rounded-full hover:bg-muted flex items-center justify-center shrink-0 text-fg-muted"
                    aria-label="Cancelar grabación"
                  >
                    <X className="w-5 h-5" />
                  </button>
                  <div className="flex-1 flex items-center gap-2 text-rose-600 dark:text-rose-400 font-semibold text-sm">
                    <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse shrink-0" />
                    <span>
                      Grabando… {String(Math.floor(recordSecs / 60)).padStart(2, '0')}:{String(recordSecs % 60).padStart(2, '0')}
                    </span>
                  </div>
                  <button
                    onClick={stopRecording}
                    className="w-10 h-10 rounded-full bg-teal-600 hover:bg-teal-500 text-white flex items-center justify-center shrink-0"
                    aria-label="Enviar nota de voz"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <div className="px-2 pt-2 flex items-end gap-1.5">
                  <button
                    onClick={() => {
                      fileRef.current?.removeAttribute('capture');
                      fileRef.current?.click();
                    }}
                    disabled={busy}
                    className="w-10 h-10 rounded-full hover:bg-muted flex items-center justify-center shrink-0 text-fg-muted disabled:opacity-40"
                    aria-label="Adjuntar archivo"
                  >
                    <Paperclip className="w-5 h-5" />
                  </button>
                  <button
                    onClick={() => {
                      fileRef.current?.setAttribute('capture', 'environment');
                      fileRef.current?.click();
                    }}
                    disabled={busy}
                    className="w-10 h-10 rounded-full hover:bg-muted flex items-center justify-center shrink-0 text-fg-muted disabled:opacity-40"
                    aria-label="Cámara"
                  >
                    <Camera className="w-5 h-5" />
                  </button>
                  <button
                    onClick={startRecording}
                    disabled={busy}
                    className="w-10 h-10 rounded-full hover:bg-muted flex items-center justify-center shrink-0 text-fg-muted disabled:opacity-40"
                    aria-label="Grabar nota de voz"
                  >
                    <Mic className="w-5 h-5" />
                  </button>
                  <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        send();
                      }
                    }}
                    rows={1}
                    placeholder="Escribí tu respuesta…"
                    className="flex-1 min-w-0 resize-none bg-panel border border-line rounded-3xl px-4 py-2.5 text-base text-fg placeholder-fg-muted outline-none focus:border-teal-500 max-h-28"
                  />
                  <button
                    onClick={send}
                    disabled={busy || (!input.trim() && !staged)}
                    className="w-10 h-10 rounded-full bg-teal-600 hover:bg-teal-500 disabled:opacity-40 text-white flex items-center justify-center shrink-0"
                    aria-label="Enviar"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}

      <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={onFile} />
    </div>
    </div>
  );
};
