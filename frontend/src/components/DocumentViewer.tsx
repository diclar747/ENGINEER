import React, { useCallback, useEffect, useRef, useState } from 'react';
import { X, ZoomIn, ZoomOut, RotateCw, Download, Printer, Share2, Maximize2, Loader2, FileText, Check } from 'lucide-react';

interface DocumentViewerProps { open: boolean; onClose: () => void; url: string; title?: string; }
const MIN_SCALE = 1, MAX_SCALE = 6, STEP = 0.35;
const absoluteUrl = (u: string): string => { try { return new URL(u, window.location.origin).href; } catch { return u; } };
const isPdf = (u: string): boolean => /\.pdf(\?|#|$)/i.test(u);

export const DocumentViewer: React.FC<DocumentViewerProps> = ({ open, onClose, url, title }) => {
  const abs = absoluteUrl(url); const pdf = isPdf(url);
  const [scale, setScale] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [loading, setLoading] = useState(true);
  const [errored, setErrored] = useState(false);
  const [shared, setShared] = useState(false);
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const pinchRef = useRef<{ dist: number; scale: number } | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const reset = useCallback(() => { setScale(1); setRotation(0); setOffset({ x: 0, y: 0 }); }, []);

  useEffect(() => { if (open) { reset(); setLoading(true); setErrored(false); } }, [open, url, reset]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeBtnRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (pdf) return;
      if (e.key === '+' || e.key === '=') setScale((s) => Math.min(MAX_SCALE, s + STEP));
      else if (e.key === '-' || e.key === '_') setScale((s) => Math.max(MIN_SCALE, s - STEP));
      else if (e.key === '0') reset();
      else if (e.key.toLowerCase() === 'r') setRotation((r) => (r + 90) % 360);
      else if (e.key === 'ArrowLeft') setOffset((o) => ({ ...o, x: o.x + 40 }));
      else if (e.key === 'ArrowRight') setOffset((o) => ({ ...o, x: o.x - 40 }));
      else if (e.key === 'ArrowUp') setOffset((o) => ({ ...o, y: o.y + 40 }));
      else if (e.key === 'ArrowDown') setOffset((o) => ({ ...o, y: o.y - 40 }));
    };
    window.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey); };
  }, [open, pdf, onClose, reset]);

  if (!open) return null;
  const zoomIn = () => setScale((s) => Math.min(MAX_SCALE, s + STEP));
  const zoomOut = () => setScale((s) => Math.max(MIN_SCALE, s - STEP));
  const rotate = () => setRotation((r) => (r + 90) % 360);
  const onWheel = (e: React.WheelEvent) => { if (pdf) return; const d = e.deltaY > 0 ? -1 : 1; setScale((s) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s + d * STEP))); };
  const onDoubleClick = () => { if (pdf) return; setOffset({ x: 0, y: 0 }); setScale((s) => (s > 1 ? 1 : 2.5)); };
  const onPointerDown = (e: React.PointerEvent) => { if (pdf || scale <= 1) return; (e.target as HTMLElement).setPointerCapture?.(e.pointerId); dragRef.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y }; };
  const onPointerMove = (e: React.PointerEvent) => { if (!dragRef.current) return; setOffset({ x: dragRef.current.ox + (e.clientX - dragRef.current.x), y: dragRef.current.oy + (e.clientY - dragRef.current.y) }); };
  const onPointerUp = () => { dragRef.current = null; };
  const onTouchStart = (e: React.TouchEvent) => { if (pdf || e.touches.length !== 2) return; const [a, b] = [e.touches[0], e.touches[1]]; pinchRef.current = { dist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), scale }; };
  const onTouchMove = (e: React.TouchEvent) => { if (!pinchRef.current || e.touches.length !== 2) return; const [a, b] = [e.touches[0], e.touches[1]]; const dd = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY); setScale(Math.min(MAX_SCALE, Math.max(MIN_SCALE, pinchRef.current.scale * (dd / pinchRef.current.dist)))); };
  const onTouchEnd = () => { pinchRef.current = null; };

  const doDownload = async () => {
    try {
      const res = await fetch(abs, { credentials: 'include' });
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const objUrl = URL.createObjectURL(blob);
      const extMatch = abs.split('?')[0].match(/\.[a-z0-9]+$/i);
      const ext = pdf ? '.pdf' : (extMatch ? extMatch[0] : '');
      const a = document.createElement('a');
      a.href = objUrl; a.download = `${(title || 'estudio').replace(/[^\w.-]+/g, '_')}${ext}`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(objUrl), 4000);
    } catch { window.open(abs, '_blank', 'noopener'); }
  };
  const doPrint = () => {
    if (pdf) { iframeRef.current?.contentWindow?.focus(); iframeRef.current?.contentWindow?.print(); return; }
    const w = window.open('', '_blank', 'noopener,width=900,height=1200');
    if (!w) return;
    w.document.write(`<html><head><title>${(title || 'Estudio').replace(/[<>]/g, '')}</title><style>*{margin:0}body{display:flex;align-items:center;justify-content:center;min-height:100vh}img{max-width:100%;max-height:100vh}</style></head><body><img src="${abs}" onload="window.focus();window.print();"/></body></html>`);
    w.document.close();
  };
  const doShare = async () => {
    const nv = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
    if (nv.share) { try { await nv.share({ title: title || 'Estudio clínico', url: abs }); } catch { /* cancelado */ } return; }
    try { await navigator.clipboard.writeText(abs); setShared(true); setTimeout(() => setShared(false), 2000); }
    catch { window.prompt('Copiá el enlace:', abs); }
  };

  const b = 'inline-flex items-center justify-center w-9 h-9 rounded-lg bg-muted/80 hover:bg-muted text-fg border border-line transition-colors disabled:opacity-40';
  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-app/95 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={title || 'Visor de documento'}>
      <div className="flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2.5 border-b border-line bg-panel/80">
        <FileText className="w-4 h-4 text-teal-600 dark:text-teal-400 shrink-0" />
        <span className="text-xs sm:text-sm font-bold text-fg truncate flex-1">{title || 'Documento'}</span>
        {!pdf && (<>
          <button className={b} onClick={zoomOut} disabled={scale <= MIN_SCALE} aria-label="Alejar"><ZoomOut className="w-4 h-4" /></button>
          <span className="text-[11px] tabular-nums text-fg-muted w-11 text-center">{Math.round(scale * 100)}%</span>
          <button className={b} onClick={zoomIn} disabled={scale >= MAX_SCALE} aria-label="Acercar"><ZoomIn className="w-4 h-4" /></button>
          <button className={b} onClick={rotate} aria-label="Rotar"><RotateCw className="w-4 h-4" /></button>
          <button className={b} onClick={reset} aria-label="Ajustar"><Maximize2 className="w-4 h-4" /></button>
          <span className="w-px h-6 bg-muted mx-1 hidden sm:block" />
        </>)}
        <button className={b} onClick={doDownload} aria-label="Descargar"><Download className="w-4 h-4" /></button>
        <button className={b} onClick={doPrint} aria-label="Imprimir"><Printer className="w-4 h-4" /></button>
        <button className={b} onClick={doShare} aria-label="Compartir">{shared ? <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400" /> : <Share2 className="w-4 h-4" />}</button>
        <button ref={closeBtnRef} className={`${b} ml-1`} onClick={onClose} aria-label="Cerrar"><X className="w-4 h-4" /></button>
      </div>
      <div className="relative flex-1 overflow-hidden flex items-center justify-center select-none"
        onWheel={onWheel} onDoubleClick={onDoubleClick} onPointerDown={onPointerDown} onPointerMove={onPointerMove}
        onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        style={{ cursor: !pdf && scale > 1 ? (dragRef.current ? 'grabbing' : 'grab') : 'default' }}>
        {loading && !errored && (<div className="absolute inset-0 flex items-center justify-center pointer-events-none"><Loader2 className="w-8 h-8 text-teal-600 dark:text-teal-400 animate-spin" /></div>)}
        {errored ? (
          <div className="text-center px-6">
            <p className="text-sm text-fg-soft font-semibold">No se pudo cargar el documento.</p>
            <button onClick={() => window.open(abs, '_blank', 'noopener')} className="mt-3 text-xs font-bold text-teal-600 dark:text-teal-400 underline">Abrir en pestaña nueva</button>
          </div>
        ) : pdf ? (
          <iframe ref={iframeRef} src={abs} title={title || 'PDF'} className="w-full h-full bg-white"
            onLoad={() => setLoading(false)} onError={() => { setErrored(true); setLoading(false); }} />
        ) : (
          <img src={abs} alt={title || 'Estudio clínico'} draggable={false}
            onLoad={() => setLoading(false)} onError={() => { setErrored(true); setLoading(false); }}
            className="max-h-full max-w-full will-change-transform"
            style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale}) rotate(${rotation}deg)`, transition: dragRef.current || pinchRef.current ? 'none' : 'transform 0.12s ease-out' }} />
        )}
      </div>
      {!pdf && (<div className="text-center text-[10px] text-fg-muted py-1.5 border-t border-line bg-panel/80 hidden sm:block">Rueda o doble clic para zoom · arrastrá para mover · <kbd>+</kbd>/<kbd>−</kbd> · <kbd>R</kbd> rotar · <kbd>Esc</kbd> cerrar</div>)}
    </div>
  );
};
export default DocumentViewer;
