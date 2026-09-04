import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import {
  Send,
  Bot,
  RefreshCw,
  CheckCheck,
  ArrowLeft,
  Plus,
  FileText,
  Image as ImageIcon,
  Camera,
  UserRound,
  X,
} from 'lucide-react';
import { API_BASE_URL } from '../utils/api';
import { renderFormattedText } from '../utils/textFormat';

interface ChatMessage {
  id: string;
  sender: 'user' | 'bot';
  text?: string;
  timestamp: string;
  /** object URL for an image the user sent */
  imageUrl?: string;
  /** non-image attachment (pdf, etc.) */
  file?: { name: string; size: number };
  error?: boolean;
}

const now = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const prettySize = (b: number) => (b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1048576).toFixed(1)} MB`);

type PickKind = 'document' | 'gallery' | 'camera' | 'selfie';

export const BotSimulator: React.FC = () => {
  const navigate = useNavigate();
  const [phone, setPhone] = useState(() => {
    try {
      return localStorage.getItem('biopass_sim_phone') || '';
    } catch {
      return '';
    }
  });
  const [phoneError, setPhoneError] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [staged, setStaged] = useState<{ file: File; previewUrl?: string } | null>(null);
  const [attachOpen, setAttachOpen] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const pendingKind = useRef<PickKind>('document');

  // Persist the simulated number so it is not re-asked on every visit.
  useEffect(() => {
    try {
      if (phone.trim()) localStorage.setItem('biopass_sim_phone', phone.trim());
    } catch {
      /* ignore */
    }
  }, [phone]);

  // Nudge the user to the number field first time in.
  useEffect(() => {
    if (!phone.trim()) phoneRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages, sending, staged]);

  // Revoke object URLs on unmount to avoid leaks
  useEffect(
    () => () => {
      messages.forEach((m) => m.imageUrl && URL.revokeObjectURL(m.imageUrl));
      if (staged?.previewUrl) URL.revokeObjectURL(staged.previewUrl);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const openPicker = (kind: PickKind) => {
    pendingKind.current = kind;
    const input = fileInputRef.current;
    if (!input) return;
    input.value = '';
    if (kind === 'document') input.accept = 'application/pdf,image/*';
    else input.accept = 'image/*';
    if (kind === 'camera') input.setAttribute('capture', 'environment');
    else if (kind === 'selfie') input.setAttribute('capture', 'user');
    else input.removeAttribute('capture');
    input.click();
    setAttachOpen(false);
  };

  const onFilePicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (staged?.previewUrl) URL.revokeObjectURL(staged.previewUrl);
    const previewUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined;
    setStaged({ file, previewUrl });
  };

  const clearStaged = () => {
    if (staged?.previewUrl) URL.revokeObjectURL(staged.previewUrl);
    setStaged(null);
  };

  const send = useCallback(
    async (textOverride?: string) => {
      const text = (textOverride ?? inputText).trim();
      const file = staged?.file;
      if ((!text && !file) || sending) return;
      if (!phone.trim()) {
        setPhoneError(true);
        phoneRef.current?.focus();
        return;
      }
      setPhoneError(false);

      const stamp = now();
      const localImageUrl = file && file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined;
      setMessages((p) => [
        ...p,
        {
          id: `u-${Date.now()}`,
          sender: 'user',
          text: text || undefined,
          timestamp: stamp,
          imageUrl: localImageUrl,
          file: file && !localImageUrl ? { name: file.name, size: file.size } : undefined,
        },
      ]);
      if (!textOverride) setInputText('');
      setStaged(null);
      setSending(true);

      try {
        const fd = new FormData();
        fd.append('from', phone.replace(/[^0-9]/g, ''));
        fd.append('body', text);
        if (file) fd.append('media', file, file.name);

        const { data } = await axios.post(`${API_BASE_URL}/bot/simulate-message`, fd);
        setMessages((p) => [
          ...p,
          {
            id: `b-${Date.now()}`,
            sender: 'bot',
            text: data.reply,
            timestamp: now(),
            imageUrl: data.mediaAttachment?.dataUrl,
          },
        ]);
      } catch {
        setMessages((p) => [
          ...p,
          {
            id: `e-${Date.now()}`,
            sender: 'bot',
            text: '⚠️ Error de comunicación con el motor del bot.',
            timestamp: now(),
            error: true,
          },
        ]);
      } finally {
        setSending(false);
      }
    },
    [inputText, staged, sending, phone],
  );

  // Note: a missing phone number does NOT disable the button — tapping it surfaces
  // the amber "poné un nº" hint instead of silently doing nothing.
  const canSend = (!!inputText.trim() || !!staged) && !sending;

  return (
    <div className="fixed inset-0 flex flex-col bg-[#0b141a] text-slate-100">
      {/* ---- Header ---- */}
      <header
        className="bg-[#075E54] text-white flex items-center gap-2 px-2 shadow-md shrink-0"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <div className="flex items-center gap-2 w-full py-2">
          <button
            onClick={() => navigate('/dashboard')}
            className="p-1.5 -ml-0.5 hover:bg-white/10 rounded-full transition-colors shrink-0"
            aria-label="Volver"
          >
            <ArrowLeft className="w-6 h-6" />
          </button>
          <div className="w-10 h-10 rounded-full bg-slate-950/40 flex items-center justify-center p-1 border border-white/20 shrink-0">
            <Bot className="w-6 h-6 text-emerald-300" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-[15px] font-semibold leading-tight truncate">Bio-Pass · Asistente Oficial</h1>
            <span className="text-[11px] text-emerald-200/90 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
              {sending ? 'escribiendo…' : 'en línea'}
            </span>
          </div>
          <button
            onClick={() => send('REINICIAR')}
            title="Reiniciar conversación"
            className="p-2 hover:bg-white/10 rounded-full transition-colors shrink-0"
            aria-label="Reiniciar"
          >
            <RefreshCw className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* ---- Simulated number ---- */}
      <div
        className={`flex items-center gap-2 px-4 py-2 border-b shrink-0 transition-colors ${
          phoneError
            ? 'bg-amber-950/50 border-amber-500/60 ring-1 ring-inset ring-amber-500/50'
            : 'bg-[#0c1c26] border-black/30'
        }`}
      >
        <span
          className={`text-[11px] font-semibold uppercase tracking-wide shrink-0 ${
            phoneError ? 'text-amber-300' : 'text-slate-400'
          }`}
        >
          {phoneError ? '👆 Poné un nº' : 'Simulás el nº'}
        </span>
        <input
          ref={phoneRef}
          type="tel"
          inputMode="numeric"
          value={phone}
          onChange={(e) => {
            setPhone(e.target.value);
            if (e.target.value.trim()) setPhoneError(false);
          }}
          placeholder="595981123456"
          className="flex-1 min-w-0 bg-transparent text-base font-mono font-bold text-teal-300 focus:outline-none placeholder-slate-600"
        />
      </div>

      {/* ---- Messages ---- */}
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 py-3 space-y-2 bg-[#0b141a]"
        onClick={() => setAttachOpen(false)}
      >
        {messages.length === 0 && (
          <p className="text-center text-sm text-slate-500 mt-10 px-8 leading-relaxed">
            {phone.trim()
              ? 'Escribí un mensaje, o tocá + para enviar una foto, PDF o sacarte una selfie. El bot procesa todo con IA.'
              : 'Poné un número arriba para empezar a chatear con el asistente real.'}
          </p>
        )}

        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[85%] rounded-2xl px-3 py-2 shadow-md text-[15px] leading-relaxed break-words ${
                m.sender === 'user'
                  ? 'bg-[#005c4b] text-white rounded-br-md'
                  : m.error
                    ? 'bg-rose-950/60 text-rose-100 rounded-bl-md border border-rose-800/50'
                    : 'bg-[#202c33] text-slate-100 rounded-bl-md border border-slate-700/40'
              }`}
            >
              {m.imageUrl && (
                <img
                  src={m.imageUrl}
                  alt="adjunto"
                  className="rounded-xl mb-1 max-h-64 w-auto object-cover"
                />
              )}
              {m.file && (
                <div className="flex items-center gap-2 mb-1 bg-black/20 rounded-xl px-3 py-2">
                  <FileText className="w-6 h-6 text-teal-300 shrink-0" />
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium truncate">{m.file.name}</div>
                    <div className="text-[11px] text-slate-300/70">{prettySize(m.file.size)}</div>
                  </div>
                </div>
              )}
              {m.text && <div>{renderFormattedText(m.text)}</div>}
              <div className="mt-0.5 flex items-center justify-end gap-1 text-[11px] text-slate-300/60">
                <span>{m.timestamp}</span>
                {m.sender === 'user' && <CheckCheck className="w-3.5 h-3.5 text-cyan-400" />}
              </div>
            </div>
          </div>
        ))}

        {sending && (
          <div className="flex justify-start">
            <div className="bg-[#202c33] text-slate-400 rounded-2xl rounded-bl-md px-4 py-2.5 text-[15px] border border-slate-700/40">
              escribiendo…
            </div>
          </div>
        )}
      </div>

      {/* ---- Staged attachment preview ---- */}
      {staged && (
        <div className="bg-[#111b21] px-3 py-2 border-t border-black/40 shrink-0">
          <div className="flex items-center gap-3 bg-[#202c33] rounded-xl p-2">
            {staged.previewUrl ? (
              <img src={staged.previewUrl} alt="" className="w-14 h-14 rounded-lg object-cover shrink-0" />
            ) : (
              <div className="w-14 h-14 rounded-lg bg-black/30 flex items-center justify-center shrink-0">
                <FileText className="w-7 h-7 text-teal-300" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium truncate">{staged.file.name}</div>
              <div className="text-[11px] text-slate-400">{prettySize(staged.file.size)} · listo para enviar</div>
            </div>
            <button onClick={clearStaged} className="p-2 hover:bg-white/10 rounded-full shrink-0" aria-label="Quitar">
              <X className="w-5 h-5 text-slate-300" />
            </button>
          </div>
        </div>
      )}

      {/* ---- Composer ---- */}
      <div
        className="relative bg-[#1f2c33] px-2 pt-2 flex items-end gap-1.5 border-t border-black/40 shrink-0"
        style={{ paddingBottom: 'calc(0.5rem + env(safe-area-inset-bottom))' }}
      >
        {/* attach popover */}
        {attachOpen && (
          <div className="absolute bottom-full left-2 mb-2 w-52 bg-[#233138] rounded-2xl shadow-2xl border border-black/40 overflow-hidden py-1 z-10">
            {(
              [
                { k: 'document' as const, icon: FileText, label: 'Documento / PDF', color: 'text-violet-300' },
                { k: 'gallery' as const, icon: ImageIcon, label: 'Galería', color: 'text-sky-300' },
                { k: 'camera' as const, icon: Camera, label: 'Cámara', color: 'text-rose-300' },
                { k: 'selfie' as const, icon: UserRound, label: 'Selfie', color: 'text-emerald-300' },
              ]
            ).map(({ k, icon: Icon, label, color }) => (
              <button
                key={k}
                onClick={() => openPicker(k)}
                className="w-full flex items-center gap-3 px-4 py-3 text-[15px] text-slate-100 hover:bg-white/5 transition-colors"
              >
                <Icon className={`w-5 h-5 ${color}`} />
                {label}
              </button>
            ))}
          </div>
        )}

        <button
          onClick={() => {
            if (!phone.trim()) {
              setPhoneError(true);
              phoneRef.current?.focus();
              return;
            }
            setAttachOpen((v) => !v);
          }}
          className={`w-11 h-11 rounded-full flex items-center justify-center shrink-0 transition-transform ${
            attachOpen ? 'bg-white/10 rotate-45' : 'hover:bg-white/5'
          }`}
          aria-label="Adjuntar"
        >
          <Plus className="w-6 h-6 text-slate-200" />
        </button>

        <textarea
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          rows={1}
          placeholder="Escribí un mensaje"
          className="flex-1 min-w-0 resize-none bg-[#2a3942] text-white text-base px-4 py-2.5 rounded-3xl outline-none focus:ring-1 focus:ring-emerald-600 placeholder-slate-400 max-h-32"
        />

        <button
          onClick={() => send()}
          disabled={!canSend}
          className="w-11 h-11 rounded-full bg-[#00a884] hover:bg-[#06cf9c] disabled:opacity-40 text-white flex items-center justify-center shrink-0 shadow-md active:scale-95 transition-transform"
          aria-label="Enviar"
        >
          <Send className="w-5 h-5" />
        </button>
      </div>

      <input ref={fileInputRef} type="file" className="hidden" onChange={onFilePicked} />
    </div>
  );
};
