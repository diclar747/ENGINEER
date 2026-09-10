import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { adminApi } from '../utils/adminApi';
import { ThemeToggle } from '../components/ThemeToggle';
import { useConfirm, useToast } from '../components/ui/Feedback';
import { AreaLine, Bars, Donut, HBars, CH } from '../components/ui/Charts';
import { Section, SectionHead, PageTitle, Toolbar, TableWrap, EmptyState, Stat, Segmented, inputCls as sharedInputCls } from '../components/ui/Layout';
import {
  ShieldCheck, LogOut, Users, CreditCard, ListChecks, LayoutDashboard, CalendarClock,
  Loader2, Search, Check, X, RefreshCw, Plus, Trash2, Save, Smartphone, Download, Printer,
  KeyRound, Unlock, CalendarPlus, Pencil, ExternalLink, TrendingUp, DollarSign, UserPlus, Activity,
  Sparkles, Wifi, WifiOff, Send, AlertTriangle, ArrowDownLeft, ArrowUpRight, QrCode, MessagesSquare,
} from 'lucide-react';

const STATUS_COLOR: Record<string, string> = {
  PAID: CH.emerald, PENDING: CH.amber, FAILED: CH.rose, EXPIRED: CH.slate,
  ACTIVE: CH.emerald, PENDING_PAYMENT: CH.amber, CANCELLED: CH.rose, PURGED: CH.slate,
};
const rangePreset = (days: number) => {
  const to = new Date();
  const from = new Date(to.getTime() - (days - 1) * 864e5);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
};

type Tab = 'resumen' | 'clientes' | 'suscripciones' | 'pagos' | 'contenido' | 'ia' | 'whatsapp' | 'historial';
const money = (n: number) => new Intl.NumberFormat('es-PY').format(Number(n) || 0);
const fdate = (s?: string) => (s ? new Date(s).toLocaleDateString('es-PY') : '—');
const parseMedsSafe = (raw: any): any[] => {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string' && raw.trim()) { try { const a = JSON.parse(raw); return Array.isArray(a) ? a : []; } catch { return []; } }
  return [];
};
const fdatetime = (s?: string) => (s ? new Date(s).toLocaleString('es-PY') : '—');
const STATUS: Record<string, string> = {
  ACTIVE: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300', PENDING_PAYMENT: 'bg-amber-500/15 text-amber-600 dark:text-amber-300',
  EXPIRED: 'bg-slate-500/15 text-fg-soft', CANCELLED: 'bg-rose-500/15 text-rose-600 dark:text-rose-300',
  PURGED: 'bg-muted text-fg-muted', PAID: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300',
  PENDING: 'bg-amber-500/15 text-amber-600 dark:text-amber-300', FAILED: 'bg-rose-500/15 text-rose-600 dark:text-rose-300',
};
const GATEWAYS = ['BANCARD', 'PIX', 'MERCADOPAGO', 'BANK_TRANSFER', 'TIGO_MONEY', 'WINSAP'];
const Loading: React.FC = () => (<div className="py-16 text-center"><Loader2 className="w-6 h-6 animate-spin inline text-teal-600 dark:text-teal-400" /></div>);
const inputCls = sharedInputCls;

const Pager: React.FC<{ page: number; total: number; onPage: (p: number) => void }> = ({ page, total, onPage }) => {
  const pages = Math.max(1, Math.ceil(total / 20));
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-center gap-2 text-xs">
      <button disabled={page <= 1} onClick={() => onPage(page - 1)} className="px-3 py-1.5 rounded-lg bg-muted disabled:opacity-40">Anterior</button>
      <span className="text-fg-muted">{page} / {pages}</span>
      <button disabled={page >= pages} onClick={() => onPage(page + 1)} className="px-3 py-1.5 rounded-lg bg-muted disabled:opacity-40">Siguiente</button>
    </div>
  );
};

export const AdminPanel: React.FC = () => {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('resumen');
  const authed = !!localStorage.getItem('biopass_admin_token');
  useEffect(() => { if (!authed) navigate('/admin/login'); }, [authed, navigate]);
  if (!authed) return null;
  const logout = () => { localStorage.removeItem('biopass_admin_token'); navigate('/admin/login'); };
  const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'resumen', label: 'Resumen', icon: <LayoutDashboard className="w-4 h-4" /> },
    { id: 'clientes', label: 'Clientes', icon: <Users className="w-4 h-4" /> },
    { id: 'suscripciones', label: 'Suscripciones', icon: <CalendarClock className="w-4 h-4" /> },
    { id: 'pagos', label: 'Pagos', icon: <CreditCard className="w-4 h-4" /> },
    { id: 'contenido', label: 'Contenido', icon: <ListChecks className="w-4 h-4" /> },
    { id: 'ia', label: 'IA', icon: <Sparkles className="w-4 h-4" /> },
    { id: 'whatsapp', label: 'WhatsApp', icon: <Smartphone className="w-4 h-4" /> },
    { id: 'historial', label: 'Historial', icon: <MessagesSquare className="w-4 h-4" /> },
  ];
  const current = TABS.find((t) => t.id === tab);
  return (
    <div className="min-h-screen bg-app text-fg">
      <header className="sticky top-0 z-30 bg-card/90 backdrop-blur-md border-b border-line print:hidden">
        <div className="max-w-6xl mx-auto px-3 sm:px-4 py-2.5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <ShieldCheck className="w-5 h-5 text-teal-600 dark:text-teal-400 shrink-0" />
            <span className="font-black text-fg text-sm sm:text-base">Bio-Pass</span>
            <span className="text-fg-muted hidden sm:inline">·</span>
            <span className="text-fg-muted text-sm font-bold hidden sm:inline">Admin</span>
            {current && <span className="text-fg-soft text-xs font-bold ml-0.5 truncate sm:hidden">/ {current.label}</span>}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <ThemeToggle />
            <button onClick={logout} title="Cerrar sesión" className="flex items-center gap-1.5 text-xs font-bold text-fg-muted hover:text-fg px-2 py-1.5 rounded-lg hover:bg-muted">
              <LogOut className="w-4 h-4" /><span className="hidden sm:inline">Salir</span>
            </button>
          </div>
        </div>
        <div className="max-w-6xl mx-auto px-2 sm:px-4">
          <nav className="flex gap-1 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [-webkit-overflow-scrolling:touch]">
            {TABS.map((t) => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold shrink-0 transition-colors ${tab === t.id ? 'bg-teal-500 text-slate-950 shadow-sm' : 'text-fg-soft hover:bg-muted'}`}>
                {t.icon}{t.label}
              </button>
            ))}
          </nav>
        </div>
      </header>
      <main className="p-3 sm:p-5 max-w-6xl mx-auto">
        {tab === 'resumen' && <Resumen />}
        {tab === 'clientes' && <Clientes />}
        {tab === 'suscripciones' && <Suscripciones />}
        {tab === 'pagos' && <Pagos />}
        {tab === 'contenido' && <Contenido />}
        {tab === 'ia' && <IA />}
        {tab === 'whatsapp' && <BotPanel />}
        {tab === 'historial' && <BotHistory />}
      </main>
    </div>
  );
};

/* ───────────────────────────────  Resumen  ─────────────────────────────── */

const Kpi: React.FC<{ label: string; value: React.ReactNode; hint?: string; icon: React.ReactNode; tone?: string }> = ({ label, value, hint, icon, tone = 'text-teal-600 dark:text-teal-400' }) => (
  <div className="bg-card border border-line rounded-2xl p-4">
    <div className="flex items-center justify-between">
      <p className="text-[11px] font-bold text-fg-muted uppercase tracking-wide">{label}</p>
      <span className={tone}>{icon}</span>
    </div>
    <p className="text-2xl font-black text-fg mt-1.5">{value}</p>
    {hint && <p className="text-[11px] text-fg-muted mt-0.5">{hint}</p>}
  </div>
);

// Card del panel = Section compartida (misma base visual que el dashboard).
const Card: React.FC<{ title?: string; children: React.ReactNode; right?: React.ReactNode }> = ({ title, children, right }) => (
  <Section title={title} right={right}>{children}</Section>
);

const Resumen: React.FC = () => {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [range, setRange] = useState(rangePreset(30));
  const [preset, setPreset] = useState(30);

  const load = useCallback(() => {
    setErr(null);
    adminApi.get('/admin/dashboard', { params: range })
      .then((r) => setD(r.data)).catch((e) => setErr(e?.response?.data?.error || 'Error'));
  }, [range]);
  useEffect(() => { load(); }, [load]);
  const setP = (days: number) => { setPreset(days); setRange(rangePreset(days)); };

  if (err) return <p className="text-rose-600 dark:text-rose-400 text-sm">{err}</p>;
  if (!d) return <Loading />;
  const k = d.kpis;
  const series = (d.series || []) as any[];
  const shortLabel = (iso: string) => iso.slice(8) + '/' + iso.slice(5, 7);

  return (
    <div className="space-y-4">
      {/* Rango */}
      <div className="flex flex-wrap items-center gap-2">
        {[7, 30, 90].map((n) => (
          <button key={n} onClick={() => setP(n)} className={`px-3 py-1.5 rounded-lg text-xs font-bold ${preset === n ? 'bg-teal-500 text-slate-950' : 'bg-muted text-fg-soft'}`}>{n} días</button>
        ))}
        <input type="date" value={range.from} onChange={(e) => { setPreset(0); setRange({ ...range, from: e.target.value }); }} className={inputCls} />
        <span className="text-fg-muted text-xs">→</span>
        <input type="date" value={range.to} onChange={(e) => { setPreset(0); setRange({ ...range, to: e.target.value }); }} className={inputCls} />
        <button onClick={load} className="px-3 py-2 bg-muted rounded-xl text-fg-soft"><RefreshCw className="w-4 h-4" /></button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Ingresos (rango)" value={`Gs. ${money(k.revenueInRange)}`} hint={`${k.paidInRange} pagos acreditados`} icon={<DollarSign className="w-4 h-4" />} />
        <Kpi label="Altas (rango)" value={k.newUsersInRange} hint={`${k.paymentsInRange} órdenes generadas`} icon={<UserPlus className="w-4 h-4" />} tone="text-sky-500" />
        <Kpi label="Clientes activos" value={k.active} hint={`${k.totalUsers} en total`} icon={<Activity className="w-4 h-4" />} tone="text-emerald-500" />
        <Kpi label="Pendientes de pago" value={k.pending} hint={`${k.pendingCount} órdenes pendientes`} icon={<CreditCard className="w-4 h-4" />} tone="text-amber-500" />
        <Kpi label="Ingresos totales" value={`Gs. ${money(k.revenuePYG)}`} hint={k.revenueBRL ? `+ R$ ${money(k.revenueBRL)}` : undefined} icon={<TrendingUp className="w-4 h-4" />} />
        <Kpi label="Pagos acreditados" value={k.paidCount} icon={<Check className="w-4 h-4" />} tone="text-emerald-500" />
        <Kpi label="Vencidos / cancelados" value={k.expired + k.cancelled} icon={<X className="w-4 h-4" />} tone="text-rose-500" />
        <Kpi label="Estudios cargados" value={k.studies} icon={<ListChecks className="w-4 h-4" />} tone="text-violet-500" />
      </div>

      {/* Gráficos */}
      <div className="grid lg:grid-cols-2 gap-3">
        <Card title={`Ingresos por día · Gs. ${money(k.revenueInRange)}`}>
          <AreaLine data={series.map((x) => ({ label: shortLabel(x.date), value: x.revenue }))} color={CH.teal} height={140} />
          <div className="flex justify-between text-[10px] text-fg-muted mt-1"><span>{shortLabel(d.range.from)}</span><span>{shortLabel(d.range.to)}</span></div>
        </Card>
        <Card title="Pagos por estado">
          <Donut data={(d.byStatus || []).map((x: any) => ({ label: x.status, value: x.count, color: STATUS_COLOR[x.status] || CH.slate }))} />
        </Card>
        <Card title="Órdenes generadas por día">
          <Bars data={series.map((x) => ({ label: x.date, value: x.payments }))} color={CH.sky} height={110} />
        </Card>
        <Card title="Altas de clientes por día">
          <Bars data={series.map((x) => ({ label: x.date, value: x.newUsers }))} color={CH.emerald} height={110} />
        </Card>
        <Card title="Pagos por pasarela (rango)">
          <HBars data={(d.byGateway || []).map((x: any) => ({ label: x.gateway, value: x.count, sub: `${x.count} · Gs. ${money(x.sum)}` }))} />
        </Card>
        <Card title="Clientes por estado">
          <HBars data={(d.usersByStatus || []).map((x: any) => ({ label: x.status, value: x.count }))} color={CH.violet} />
        </Card>
      </div>

      {/* Movimientos */}
      <Movimientos />
    </div>
  );
};

const MOV_TYPES: Record<string, string> = { PAYMENT: 'Pago', SIGNUP: 'Alta', SUBSCRIPTION: 'Suscripción' };
const Movimientos: React.FC = () => {
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [f, setF] = useState({ type: '', status: '', from: '', to: '' });
  const load = useCallback(() => {
    setLoading(true);
    adminApi.get('/admin/movements', { params: { page, ...f } })
      .then((r) => { setRows(r.data.rows); setTotal(r.data.total); }).finally(() => setLoading(false));
  }, [page, f]);
  useEffect(() => { load(); }, [load]);
  const set = (k: string, v: string) => { setPage(1); setF({ ...f, [k]: v }); };
  return (
    <Card title="Movimientos" right={<span className="text-[11px] text-fg-muted">{total} registros</span>}>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <select value={f.type} onChange={(e) => set('type', e.target.value)} className={inputCls}>
          <option value="">Categoría: todas</option>
          <option value="PAYMENT">Pagos</option><option value="SIGNUP">Altas</option><option value="SUBSCRIPTION">Suscripciones</option>
        </select>
        <input value={f.status} onChange={(e) => set('status', e.target.value)} placeholder="Estado" className={`${inputCls} w-28`} />
        <input type="date" value={f.from} onChange={(e) => set('from', e.target.value)} className={inputCls} />
        <span className="text-fg-muted text-xs">→</span>
        <input type="date" value={f.to} onChange={(e) => set('to', e.target.value)} className={inputCls} />
        <button onClick={load} className="px-3 py-2 bg-muted rounded-xl text-fg-soft"><RefreshCw className="w-4 h-4" /></button>
      </div>
      <div className="overflow-x-auto overscroll-x-contain rounded-xl border border-line/60 [-webkit-overflow-scrolling:touch]">
        <table className="w-full text-xs min-w-[640px]">
          <thead className="text-fg-muted border-b border-line"><tr>{['Fecha', 'Tipo', 'Detalle', 'Estado', 'Monto'].map((h) => <th key={h} className="text-left font-semibold px-2 py-2 whitespace-nowrap">{h}</th>)}</tr></thead>
          <tbody>
            {loading && <tr><td colSpan={5} className="py-6 text-center"><Loader2 className="w-4 h-4 animate-spin inline text-teal-500" /></td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={5} className="py-6 text-center text-fg-muted">Sin movimientos</td></tr>}
            {!loading && rows.map((m, i) => (
              <tr key={i} className="border-b border-line/50">
                <td className="px-2 py-2 whitespace-nowrap">{fdatetime(m.at)}</td>
                <td className="px-2 py-2"><span className="px-1.5 py-0.5 rounded bg-muted text-fg-soft font-bold text-[10px]">{MOV_TYPES[m.type] || m.type}</span></td>
                <td className="px-2 py-2"><span className="font-semibold text-fg">{m.title}</span> <span className="text-fg-muted">· {m.subtitle}</span></td>
                <td className="px-2 py-2"><span className={`px-2 py-0.5 rounded-full font-bold ${STATUS[m.status] || 'bg-muted'}`}>{m.status}</span></td>
                <td className="px-2 py-2 whitespace-nowrap font-semibold text-fg">{m.amount != null ? `${money(m.amount)} ${m.currency || ''}` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3"><Pager page={page} total={total} onPage={setPage} /></div>
    </Card>
  );
};

/* ────────────────────────────  User drawer  ───────────────────────────── */

const Field: React.FC<{ label: string; value: string; onChange: (v: string) => void; placeholder?: string }> = ({ label, value, onChange, placeholder }) => (
  <label className="block">
    <span className="text-[11px] font-semibold text-fg-muted">{label}</span>
    <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
      className="w-full mt-1 bg-panel border border-line rounded-lg px-3 py-2 text-sm text-fg outline-none focus:border-teal-500" />
  </label>
);

const UserDrawer: React.FC<{ userId: string; onClose: () => void; onChanged: () => void }> = ({ userId, onClose, onChanged }) => {
  const confirm = useConfirm();
  const toast = useToast();
  const [data, setData] = useState<any>(null);
  const [form, setForm] = useState<any>({});
  const [busy, setBusy] = useState(false);
  const [extend, setExtend] = useState({ months: 12, days: 0 });

  const load = useCallback(() => {
    adminApi.get(`/admin/users/${userId}`).then((r) => {
      setData(r.data.user);
      const u = r.data.user;
      setForm({
        fullName: u.fullName || '', phoneNumber: u.phoneNumber || '', ciNumber: u.ciNumber || '',
        email: u.email || '', bloodType: u.bloodType || '', dateOfBirth: u.dateOfBirth || '',
        birthPlace: u.birthPlace || '', sex: u.sex || '', address: u.address || '', language: u.language || 'ES',
      });
    });
  }, [userId]);
  useEffect(() => { load(); }, [load]);

  const act = async (fn: () => Promise<any>, okMsg: string) => {
    setBusy(true);
    try { await fn(); toast.success(okMsg); load(); onChanged(); }
    catch (e: any) { toast.error(e?.response?.data?.error || 'No se pudo completar la acción.'); }
    finally { setBusy(false); }
  };

  const save = () => act(() => adminApi.patch(`/admin/users/${userId}`, form), 'Datos actualizados.');
  const setStatus = (status: string, months?: number) => act(() => adminApi.patch(`/admin/users/${userId}/status`, { status, months }), `Estado: ${status}.`);
  const unlockPin = () => act(() => adminApi.post(`/admin/users/${userId}/unlock-pin`), 'PIN desbloqueado.');

  const resetPin = async () => {
    const ok = await confirm({
      title: 'Resetear PIN', danger: true, confirmText: 'Resetear PIN',
      message: (<>El usuario deberá elegir un <b>PIN nuevo</b> por WhatsApp. La <b>bóveda médica cifrada se reinicia vacía</b> (el historial de consultas cifrado se pierde; los estudios subidos y la ficha pública se conservan).</>),
    });
    if (ok) act(() => adminApi.post(`/admin/users/${userId}/reset-pin`), 'PIN reseteado. El usuario debe elegir uno nuevo por WhatsApp.');
  };
  const doExtend = () => {
    if (extend.months <= 0 && extend.days <= 0) return;
    act(() => adminApi.post(`/admin/users/${userId}/extend`, extend), 'Suscripción extendida.');
  };
  const del = async () => {
    const ok = await confirm({
      title: 'Eliminar usuario', danger: true, confirmText: 'Eliminar definitivamente',
      message: (<>Se borran el usuario, sus suscripciones, pagos, estudios y contactos. <b>Es irreversible.</b></>),
    });
    if (ok) { await adminApi.delete(`/admin/users/${userId}`).catch(() => {}); toast.success('Usuario eliminado.'); onChanged(); onClose(); }
  };

  return (
    <div className="fixed inset-0 z-[200] flex justify-end bg-app/70 backdrop-blur-sm print:hidden" onClick={onClose}>
      <div className="w-full max-w-lg h-full overflow-y-auto bg-card border-l border-line p-5 space-y-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-black text-fg">{data?.fullName || 'Usuario'}</h2>
            <p className="text-xs text-fg-muted font-mono">{data?.phoneNumber}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg bg-muted text-fg-soft"><X className="w-4 h-4" /></button>
        </div>

        {!data ? <Loading /> : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${STATUS[data.status] || 'bg-muted'}`}>{data.status}</span>
              {data.emergencyToken && (
                <a href={`/e/${data.emergencyToken}`} target="_blank" rel="noreferrer" className="text-[11px] font-bold text-teal-600 dark:text-teal-400 inline-flex items-center gap-1">
                  Ficha pública <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>

            {/* Acciones */}
            <div className="grid grid-cols-2 gap-2">
              {data.status !== 'ACTIVE'
                ? <button disabled={busy} onClick={() => setStatus('ACTIVE', 12)} className="col-span-2 px-3 py-2 rounded-xl bg-emerald-600 text-white text-xs font-black inline-flex items-center justify-center gap-1.5 disabled:opacity-50"><Check className="w-3.5 h-3.5" />Activar (+12 meses)</button>
                : <button disabled={busy} onClick={() => setStatus('CANCELLED')} className="col-span-2 px-3 py-2 rounded-xl bg-rose-600/80 text-white text-xs font-black inline-flex items-center justify-center gap-1.5 disabled:opacity-50"><X className="w-3.5 h-3.5" />Suspender</button>}
              <button disabled={busy} onClick={unlockPin} className="px-3 py-2 rounded-xl bg-muted text-fg-soft text-xs font-bold inline-flex items-center justify-center gap-1.5 disabled:opacity-50"><Unlock className="w-3.5 h-3.5" />Desbloquear PIN</button>
              <button disabled={busy} onClick={resetPin} className="px-3 py-2 rounded-xl bg-amber-500/15 text-amber-700 dark:text-amber-300 text-xs font-bold inline-flex items-center justify-center gap-1.5 disabled:opacity-50"><KeyRound className="w-3.5 h-3.5" />Resetear PIN</button>
            </div>

            <div className="bg-panel/50 border border-line rounded-xl p-3 space-y-2">
              <p className="text-[11px] font-bold text-fg-muted uppercase">Extender suscripción</p>
              <div className="flex items-center gap-2">
                <input type="number" min={0} value={extend.months} onChange={(e) => setExtend({ ...extend, months: Number(e.target.value) })} className="w-16 bg-card border border-line rounded-lg px-2 py-1.5 text-xs text-fg" />
                <span className="text-xs text-fg-muted">meses</span>
                <input type="number" min={0} value={extend.days} onChange={(e) => setExtend({ ...extend, days: Number(e.target.value) })} className="w-16 bg-card border border-line rounded-lg px-2 py-1.5 text-xs text-fg" />
                <span className="text-xs text-fg-muted">días</span>
                <button disabled={busy} onClick={doExtend} className="ml-auto px-3 py-1.5 rounded-lg bg-teal-500 text-slate-950 text-xs font-bold inline-flex items-center gap-1 disabled:opacity-50"><CalendarPlus className="w-3.5 h-3.5" />Aplicar</button>
              </div>
            </div>

            {/* Editar datos */}
            <div className="space-y-3">
              <p className="text-[11px] font-bold text-fg-muted uppercase flex items-center gap-1.5"><Pencil className="w-3.5 h-3.5" />Editar datos</p>
              <div className="grid grid-cols-2 gap-2.5">
                <div className="col-span-2"><Field label="Nombre completo" value={form.fullName} onChange={(v) => setForm({ ...form, fullName: v })} /></div>
                <Field label="Teléfono" value={form.phoneNumber} onChange={(v) => setForm({ ...form, phoneNumber: v })} />
                <Field label="Cédula" value={form.ciNumber} onChange={(v) => setForm({ ...form, ciNumber: v })} />
                <div className="col-span-2"><Field label="Email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} /></div>
                <Field label="Tipo de sangre" value={form.bloodType} onChange={(v) => setForm({ ...form, bloodType: v })} placeholder="O+" />
                <Field label="Sexo" value={form.sex} onChange={(v) => setForm({ ...form, sex: v })} placeholder="M / F" />
                <Field label="Fecha nac." value={form.dateOfBirth} onChange={(v) => setForm({ ...form, dateOfBirth: v })} placeholder="DD/MM/AAAA" />
                <Field label="Lugar nac." value={form.birthPlace} onChange={(v) => setForm({ ...form, birthPlace: v })} />
                <div className="col-span-2"><Field label="Dirección" value={form.address} onChange={(v) => setForm({ ...form, address: v })} /></div>
                <label className="block">
                  <span className="text-[11px] font-semibold text-fg-muted">Idioma</span>
                  <select value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })} className="w-full mt-1 bg-panel border border-line rounded-lg px-3 py-2 text-sm text-fg">
                    <option value="ES">Español</option><option value="GN">Guaraní</option>
                  </select>
                </label>
              </div>
              <button disabled={busy} onClick={save} className="w-full px-4 py-2 rounded-xl bg-teal-500 text-slate-950 font-black text-sm inline-flex items-center justify-center gap-2 disabled:opacity-50">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}Guardar cambios
              </button>
            </div>

            {/* Suscripciones + pagos + estudios */}
            <div className="space-y-3 text-xs">
              <div>
                <p className="text-[11px] font-bold text-fg-muted uppercase mb-1">Suscripciones</p>
                {(data.subscriptions || []).length === 0 ? <p className="text-fg-muted">—</p> : (data.subscriptions || []).map((s: any) => (
                  <div key={s.id} className="flex items-center justify-between border-b border-line/50 py-1">
                    <span>{s.plan} · <span className={`px-1.5 rounded ${STATUS[s.status] || ''}`}>{s.status}</span></span>
                    <span className="text-fg-muted">vence {fdate(s.expiryDate)}</span>
                  </div>
                ))}
              </div>
              <div>
                <p className="text-[11px] font-bold text-fg-muted uppercase mb-1">Pagos ({(data.paymentOrders || []).length})</p>
                {(data.paymentOrders || []).slice(0, 8).map((p: any) => (
                  <div key={p.id} className="flex items-center justify-between border-b border-line/50 py-1">
                    <span>{fdate(p.createdAt)} · {p.gateway}</span>
                    <span>{money(p.amount)} {p.currency} · <span className={`px-1.5 rounded ${STATUS[p.status] || ''}`}>{p.status}</span></span>
                  </div>
                ))}
              </div>
              <div>
                <p className="text-[11px] font-bold text-fg-muted uppercase mb-1">Estudios médicos ({(data.medicalStudies || []).length})</p>
                {(data.medicalStudies || []).slice(0, 8).map((m: any) => (
                  <div key={m.id} className="flex items-center justify-between border-b border-line/50 py-1">
                    <span>{m.title || m.studyType}</span><span className="text-fg-muted">{fdate(m.createdAt)}</span>
                  </div>
                ))}
              </div>
              <div>
                <p className="text-[11px] font-bold text-fg-muted uppercase mb-1">Medicación actual ({parseMedsSafe(data.currentMedications).length})</p>
                {parseMedsSafe(data.currentMedications).slice(0, 12).map((m: any, i: number) => (
                  <div key={i} className="flex items-center justify-between border-b border-line/50 py-1">
                    <span>{m.name}</span><span className="text-fg-muted">{[m.dose, m.frequency].filter(Boolean).join(' · ')}</span>
                  </div>
                ))}
              </div>
              <div>
                <p className="text-[11px] font-bold text-fg-muted uppercase mb-1">Recordatorios ({(data.medicationReminders || []).length})</p>
                {(data.medicationReminders || []).map((r: any) => (
                  <div key={r.id} className="flex items-center justify-between border-b border-line/50 py-1 gap-2">
                    <span className="truncate">💊 {r.medication}{r.dose ? ` (${r.dose})` : ''} · ⏰ {(() => { try { return JSON.parse(r.times).join(', '); } catch { return r.times; } })()}{r.active ? '' : ' · pausado'}</span>
                    <button onClick={() => act(() => adminApi.delete(`/admin/users/${userId}/reminders/${r.id}`), 'Recordatorio eliminado.')} className="p-1 rounded bg-rose-600/15 text-rose-500 shrink-0"><Trash2 className="w-3 h-3" /></button>
                  </div>
                ))}
              </div>
            </div>

            <button onClick={del} className="w-full px-4 py-2 rounded-xl bg-rose-600/10 text-rose-600 dark:text-rose-400 border border-rose-500/30 font-bold text-xs inline-flex items-center justify-center gap-2">
              <Trash2 className="w-3.5 h-3.5" />Eliminar usuario
            </button>
          </>
        )}
      </div>
    </div>
  );
};

/* ───────────────────────────────  Clientes  ────────────────────────────── */

const Clientes: React.FC = () => {
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const load = useCallback(() => {
    setLoading(true);
    adminApi.get('/admin/users', { params: { page, search, status } })
      .then((r) => { setRows(r.data.rows); setTotal(r.data.total); }).finally(() => setLoading(false));
  }, [page, search, status]);
  useEffect(() => { load(); }, [load]);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="w-4 h-4 text-fg-muted absolute left-3 top-2.5 pointer-events-none" />
          <input value={search} onChange={(e) => { setPage(1); setSearch(e.target.value); }} placeholder="Buscar nombre, teléfono, CI…"
            className={`${inputCls} w-full pl-9`} />
        </div>
        <select value={status} onChange={(e) => { setPage(1); setStatus(e.target.value); }} className={inputCls}>
          <option value="">Todos</option><option value="ACTIVE">Activos</option><option value="PENDING_PAYMENT">Pendiente pago</option><option value="EXPIRED">Vencidos</option><option value="CANCELLED">Cancelados</option>
        </select>
        <button onClick={load} className="px-3 py-2 bg-muted rounded-xl text-fg-soft hover:bg-muted"><RefreshCw className="w-4 h-4" /></button>
      </div>
      <div className="overflow-x-auto overscroll-x-contain bg-card border border-line rounded-2xl [-webkit-overflow-scrolling:touch]">
        <table className="w-full text-xs min-w-[760px]">
          <thead className="text-fg-muted border-b border-line"><tr>{['Nombre', 'Teléfono', 'CI', 'Estado', 'Plan', 'Vence', 'Est.'].map((h) => (<th key={h} className="text-left font-semibold px-3 py-2.5 whitespace-nowrap">{h}</th>))}</tr></thead>
          <tbody>
            {loading && (<tr><td colSpan={7} className="px-3 py-8 text-center"><Loader2 className="w-5 h-5 animate-spin inline text-teal-600 dark:text-teal-400" /></td></tr>)}
            {!loading && rows.length === 0 && (<tr><td colSpan={7} className="px-3 py-8 text-center text-fg-muted">Sin resultados</td></tr>)}
            {!loading && rows.map((u) => (
              <tr key={u.id} onClick={() => setOpenId(u.id)} className="border-b border-line/60 hover:bg-teal-500/5 cursor-pointer">
                <td className="px-3 py-2.5 font-semibold text-fg whitespace-nowrap">{u.fullName || '—'}</td>
                <td className="px-3 py-2.5 font-mono whitespace-nowrap">{u.phoneNumber}</td>
                <td className="px-3 py-2.5 whitespace-nowrap">{u.ciNumber || '—'}</td>
                <td className="px-3 py-2.5"><span className={`px-2 py-0.5 rounded-full font-bold ${STATUS[u.status] || 'bg-muted'}`}>{u.status}</span></td>
                <td className="px-3 py-2.5 whitespace-nowrap">{u.subscriptions?.[0]?.plan || '—'}</td>
                <td className="px-3 py-2.5 whitespace-nowrap">{fdate(u.subscriptions?.[0]?.expiryDate)}</td>
                <td className="px-3 py-2.5 text-center">{u._count?.medicalStudies ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-fg-muted">Tocá una fila para ver el detalle, editar, activar/suspender, resetear PIN o extender la suscripción.</p>
      <Pager page={page} total={total} onPage={setPage} />
      {openId && <UserDrawer userId={openId} onClose={() => setOpenId(null)} onChanged={load} />}
    </div>
  );
};

/* ─────────────────────────────  Suscripciones  ────────────────────────── */

const Suscripciones: React.FC = () => {
  const toast = useToast();
  const [rows, setRows] = useState<any[]>([]);
  const [totals, setTotals] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [f, setF] = useState({ filter: 'all', status: '', plan: '', from: '', to: '' });
  const load = useCallback(() => {
    setLoading(true);
    adminApi.get('/admin/subscriptions', { params: { page, ...f } })
      .then((r) => { setRows(r.data.rows); setTotal(r.data.total); setTotals(r.data.totals || []); }).finally(() => setLoading(false));
  }, [page, f]);
  useEffect(() => { load(); }, [load]);
  const set = (k: string, v: string) => { setPage(1); setF({ ...f, [k]: v }); };

  const exportCsv = async () => {
    try {
      const r = await adminApi.get('/admin/subscriptions/export', { params: f, responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([r.data], { type: 'text/csv' }));
      const a = document.createElement('a'); a.href = url; a.download = `suscripciones-biopass-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(url);
    } catch { toast.error('No se pudo exportar.'); }
  };
  const printReport = async () => {
    try {
      const r = await adminApi.get('/admin/subscriptions/export', { params: { ...f, format: 'json' } });
      const rr: any[] = r.data.rows || []; const tt: any[] = r.data.totals || [];
      const w = window.open('', '_blank'); if (!w) return;
      w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Suscripciones — Bio-Pass</title>
        <style>body{font-family:system-ui,Arial,sans-serif;margin:24px;color:#111}h1{font-size:18px;margin:0}p{color:#555;font-size:12px}
        table{width:100%;border-collapse:collapse;margin-top:12px;font-size:11px}th,td{border:1px solid #ccc;padding:5px 7px;text-align:left}th{background:#f2f2f2}tfoot td{font-weight:bold;background:#fafafa}</style></head><body>
        <h1>Suscripciones — Doorway Cortex Bio-Pass</h1><p>Generado: ${new Date().toLocaleString('es-PY')} · ${rr.length} registros</p>
        <table><thead><tr><th>Cliente</th><th>Teléfono</th><th>Plan</th><th>Estado</th><th>Inicio</th><th>Vence</th><th>Días</th><th>Multa</th></tr></thead>
        <tbody>${rr.map((s) => `<tr><td>${s.cliente}</td><td>${s.telefono}</td><td>${s.plan}</td><td>${s.estado}</td><td>${s.inicio}</td><td>${s.vence}</td><td>${s.diasRestantes}</td><td>${s.multa}</td></tr>`).join('')}</tbody>
        <tfoot>${tt.map((t) => `<tr><td colspan="8">${t.count} suscripciones · ${t.currency} ${money(t.sum)}</td></tr>`).join('')}</tfoot></table></body></html>`);
      w.document.close(); w.focus(); setTimeout(() => w.print(), 300);
    } catch { toast.error('No se pudo generar el reporte.'); }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <select value={f.filter} onChange={(e) => set('filter', e.target.value)} className={inputCls}>
          <option value="all">Todas</option><option value="active">Activas</option><option value="expiring">Vencen en 7 días</option><option value="expired">Vencidas / canceladas</option>
        </select>
        <select value={f.status} onChange={(e) => set('status', e.target.value)} className={inputCls}>
          <option value="">Estado: todos</option><option value="ACTIVE">Activa</option><option value="EXPIRED">Vencida</option><option value="CANCELLED">Cancelada</option><option value="PENDING_PAYMENT">Pendiente</option>
        </select>
        <select value={f.plan} onChange={(e) => set('plan', e.target.value)} className={inputCls}>
          <option value="">Plan: todos</option><option value="MONTHLY">Mensual</option><option value="ANNUAL">Anual</option>
        </select>
        <label className="text-[11px] text-fg-muted">Desde<br /><input type="date" value={f.from} onChange={(e) => set('from', e.target.value)} className={inputCls} /></label>
        <label className="text-[11px] text-fg-muted">Hasta<br /><input type="date" value={f.to} onChange={(e) => set('to', e.target.value)} className={inputCls} /></label>
        <button onClick={load} className="px-3 py-2 bg-muted rounded-xl text-fg-soft"><RefreshCw className="w-4 h-4" /></button>
        <button onClick={exportCsv} className="px-3 py-2 rounded-xl bg-emerald-600/80 text-white text-xs font-bold inline-flex items-center gap-1.5"><Download className="w-3.5 h-3.5" />Excel/CSV</button>
        <button onClick={printReport} className="px-3 py-2 rounded-xl bg-muted text-fg-soft text-xs font-bold inline-flex items-center gap-1.5"><Printer className="w-3.5 h-3.5" />Imprimir</button>
      </div>
      {totals.length > 0 && (
        <div className="flex flex-wrap gap-2 text-xs">
          {totals.map((t) => (
            <span key={t.currency} className="px-3 py-1.5 rounded-xl bg-card border border-line font-bold text-fg">{t.count} suscripciones · <span className="text-teal-600 dark:text-teal-400">{money(t.sum)} {t.currency}</span></span>
          ))}
        </div>
      )}
      <div className="overflow-x-auto overscroll-x-contain bg-card border border-line rounded-2xl [-webkit-overflow-scrolling:touch]">
        <table className="w-full text-xs min-w-[760px]">
          <thead className="text-fg-muted border-b border-line"><tr>{['Cliente', 'Teléfono', 'Plan', 'Estado', 'Inicio', 'Vence', 'Días', 'Multa'].map((h) => (<th key={h} className="text-left font-semibold px-3 py-2.5 whitespace-nowrap">{h}</th>))}</tr></thead>
          <tbody>
            {loading && (<tr><td colSpan={8} className="px-3 py-8 text-center"><Loader2 className="w-5 h-5 animate-spin inline text-teal-600 dark:text-teal-400" /></td></tr>)}
            {!loading && rows.length === 0 && (<tr><td colSpan={8} className="px-3 py-8 text-center text-fg-muted">Sin suscripciones</td></tr>)}
            {!loading && rows.map((s) => (
              <tr key={s.id} onClick={() => setOpenId(s.user?.id)} className="border-b border-line/60 hover:bg-teal-500/5 cursor-pointer">
                <td className="px-3 py-2.5 font-semibold text-fg whitespace-nowrap">{s.user?.fullName || '—'}</td>
                <td className="px-3 py-2.5 font-mono whitespace-nowrap">{s.user?.phoneNumber}</td>
                <td className="px-3 py-2.5 whitespace-nowrap">{s.plan}</td>
                <td className="px-3 py-2.5"><span className={`px-2 py-0.5 rounded-full font-bold ${STATUS[s.status] || 'bg-muted'}`}>{s.status}</span></td>
                <td className="px-3 py-2.5 whitespace-nowrap">{fdate(s.startDate)}</td>
                <td className="px-3 py-2.5 whitespace-nowrap">{fdate(s.expiryDate)}</td>
                <td className={`px-3 py-2.5 text-center font-bold ${s.daysLeft < 0 ? 'text-rose-500' : s.daysLeft <= 7 ? 'text-amber-500' : 'text-fg-soft'}`}>{s.daysLeft}</td>
                <td className="px-3 py-2.5 text-center">{s.finePending ? '⚠️' : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager page={page} total={total} onPage={setPage} />
      {openId && <UserDrawer userId={openId} onClose={() => setOpenId(null)} onChanged={load} />}
    </div>
  );
};

/* ───────────────────────────────  Pagos  ──────────────────────────────── */

const Pagos: React.FC = () => {
  const confirm = useConfirm();
  const toast = useToast();
  const [rows, setRows] = useState<any[]>([]);
  const [totals, setTotals] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [f, setF] = useState({ status: '', gateway: '', method: '', from: '', to: '' });

  const load = useCallback(() => {
    setLoading(true);
    adminApi.get('/admin/payments', { params: { page, ...f } })
      .then((r) => { setRows(r.data.rows); setTotal(r.data.total); setTotals(r.data.totals || []); })
      .finally(() => setLoading(false));
  }, [page, f]);
  useEffect(() => { load(); }, [load]);

  const setFilter = (k: string, v: string) => { setPage(1); setF({ ...f, [k]: v }); };

  const markPaid = async (ref: string) => {
    const ok = await confirm({ title: 'Confirmar pago', confirmText: 'Marcar pagada', message: '¿Marcar esta orden como pagada y activar el Bio-Pass del cliente?' });
    if (!ok) return;
    try { await adminApi.post(`/admin/payments/${encodeURIComponent(ref)}/mark-paid`); toast.success('Pago acreditado y Bio-Pass activado.'); load(); }
    catch (e: any) { toast.error(e?.response?.data?.error || 'No se pudo marcar como pagada.'); }
  };

  const exportCsv = async () => {
    try {
      const r = await adminApi.get('/admin/payments/export', { params: f, responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([r.data], { type: 'text/csv' }));
      const a = document.createElement('a');
      a.href = url; a.download = `pagos-biopass-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click(); URL.revokeObjectURL(url);
    } catch { toast.error('No se pudo exportar.'); }
  };

  const printReport = async () => {
    try {
      const r = await adminApi.get('/admin/payments/export', { params: { ...f, format: 'json' } });
      const rr: any[] = r.data.rows || [];
      const tt: any[] = r.data.totals || [];
      const rango = f.from || f.to ? `Del ${f.from || '…'} al ${f.to || '…'}` : 'Todos los períodos';
      const filtros = [f.status, f.gateway, f.method].filter(Boolean).join(' · ') || 'Sin filtros de método/estado';
      const w = window.open('', '_blank');
      if (!w) return;
      w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Reporte de pagos — Bio-Pass</title>
        <style>body{font-family:system-ui,Arial,sans-serif;margin:24px;color:#111}h1{font-size:18px;margin:0}
        p{color:#555;font-size:12px;margin:2px 0}table{width:100%;border-collapse:collapse;margin-top:12px;font-size:11px}
        th,td{border:1px solid #ccc;padding:5px 7px;text-align:left}th{background:#f2f2f2}
        tfoot td{font-weight:bold;background:#fafafa}</style></head><body>
        <h1>Reporte de pagos — Doorway Cortex Bio-Pass</h1>
        <p>${rango} · ${filtros}</p><p>Generado: ${new Date().toLocaleString('es-PY')} · ${rr.length} registros</p>
        <table><thead><tr><th>Fecha</th><th>Cliente</th><th>Teléfono</th><th>Gateway</th><th>Método</th><th>Monto</th><th>Moneda</th><th>Estado</th><th>Referencia</th></tr></thead>
        <tbody>${rr.map((p) => `<tr><td>${new Date(p.createdAt).toLocaleString('es-PY')}</td><td>${p.fullName || ''}</td><td>${p.phoneNumber || ''}</td><td>${p.gateway}</td><td>${p.paymentMethod}</td><td style="text-align:right">${money(p.amount)}</td><td>${p.currency}</td><td>${p.status}</td><td>${p.referenceCode}</td></tr>`).join('')}</tbody>
        <tfoot>${tt.map((t) => `<tr><td colspan="5">Total ${t.currency} (${t.count} pagos)</td><td style="text-align:right">${money(t.sum)}</td><td colspan="3">${t.currency}</td></tr>`).join('')}</tfoot>
        </table></body></html>`);
      w.document.close(); w.focus(); setTimeout(() => w.print(), 300);
    } catch { toast.error('No se pudo generar el reporte.'); }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-[11px] text-fg-muted">Desde<br /><input type="date" value={f.from} onChange={(e) => setFilter('from', e.target.value)} className={inputCls} /></label>
        <label className="text-[11px] text-fg-muted">Hasta<br /><input type="date" value={f.to} onChange={(e) => setFilter('to', e.target.value)} className={inputCls} /></label>
        <select value={f.status} onChange={(e) => setFilter('status', e.target.value)} className={inputCls}>
          <option value="">Estado: todos</option><option value="PENDING">Pendientes</option><option value="PAID">Pagados</option><option value="EXPIRED">Vencidos</option><option value="FAILED">Fallidos</option>
        </select>
        <select value={f.gateway} onChange={(e) => setFilter('gateway', e.target.value)} className={inputCls}>
          <option value="">Gateway: todos</option>{GATEWAYS.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
        <input value={f.method} onChange={(e) => setFilter('method', e.target.value)} placeholder="Método (texto)" className={`${inputCls} w-36`} />
        <button onClick={load} className="px-3 py-2 bg-muted rounded-xl text-fg-soft"><RefreshCw className="w-4 h-4" /></button>
        <button onClick={exportCsv} className="px-3 py-2 rounded-xl bg-emerald-600/80 text-white text-xs font-bold inline-flex items-center gap-1.5"><Download className="w-3.5 h-3.5" />Excel/CSV</button>
        <button onClick={printReport} className="px-3 py-2 rounded-xl bg-muted text-fg-soft text-xs font-bold inline-flex items-center gap-1.5"><Printer className="w-3.5 h-3.5" />Imprimir</button>
      </div>

      {totals.length > 0 && (
        <div className="flex flex-wrap gap-2 text-xs">
          {totals.map((t) => (
            <span key={t.currency} className="px-3 py-1.5 rounded-xl bg-card border border-line font-bold text-fg">
              {t.count} pagos · <span className="text-teal-600 dark:text-teal-400">{money(t.sum)} {t.currency}</span>
            </span>
          ))}
        </div>
      )}

      <div className="overflow-x-auto overscroll-x-contain bg-card border border-line rounded-2xl [-webkit-overflow-scrolling:touch]">
        <table className="w-full text-xs min-w-[760px]">
          <thead className="text-fg-muted border-b border-line"><tr>{['Fecha', 'Cliente', 'Gateway', 'Método', 'Monto', 'Estado', 'Ref', ''].map((h) => (<th key={h} className="text-left font-semibold px-3 py-2.5 whitespace-nowrap">{h}</th>))}</tr></thead>
          <tbody>
            {loading && (<tr><td colSpan={8} className="px-3 py-8 text-center"><Loader2 className="w-5 h-5 animate-spin inline text-teal-600 dark:text-teal-400" /></td></tr>)}
            {!loading && rows.length === 0 && (<tr><td colSpan={8} className="px-3 py-8 text-center text-fg-muted">Sin pagos</td></tr>)}
            {!loading && rows.map((p) => (
              <tr key={p.id} className="border-b border-line/60 hover:bg-muted/30">
                <td className="px-3 py-2.5 whitespace-nowrap">{fdatetime(p.createdAt)}</td>
                <td className="px-3 py-2.5 whitespace-nowrap">{p.user?.fullName || p.user?.phoneNumber || '—'}</td>
                <td className="px-3 py-2.5 whitespace-nowrap">{p.gateway}</td>
                <td className="px-3 py-2.5 whitespace-nowrap">{p.paymentMethod}</td>
                <td className="px-3 py-2.5 whitespace-nowrap font-semibold text-fg">{money(p.amount)} {p.currency}</td>
                <td className="px-3 py-2.5"><span className={`px-2 py-0.5 rounded-full font-bold ${STATUS[p.status] || 'bg-muted'}`}>{p.status}</span></td>
                <td className="px-3 py-2.5 font-mono text-[10px] text-fg-muted whitespace-nowrap">{p.referenceCode}</td>
                <td className="px-3 py-2.5 whitespace-nowrap">{p.status === 'PENDING' && (<button onClick={() => markPaid(p.referenceCode)} className="px-2.5 py-1 rounded-lg bg-emerald-600/80 hover:bg-emerald-600 text-white font-bold">Marcar pagado</button>)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager page={page} total={total} onPage={setPage} />
    </div>
  );
};

/* ──────────────────────────────  Contenido  ───────────────────────────── */

const Contenido: React.FC = () => {
  const confirm = useConfirm();
  const toast = useToast();
  const [conds, setConds] = useState<any[]>([]);
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [nw, setNw] = useState({ code: '', labelEs: '', labelGn: '', sortOrder: 0 });
  const [savingS, setSavingS] = useState(false);
  const load = useCallback(() => {
    setLoading(true);
    Promise.all([adminApi.get('/admin/conditions'), adminApi.get('/admin/settings')])
      .then(([c, s]) => { setConds(c.data.rows); setSettings(s.data.settings || {}); }).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);
  const patchCond = async (id: string, data: any) => { await adminApi.patch(`/admin/conditions/${id}`, data); load(); };
  const delCond = async (id: string) => {
    if (await confirm({ title: 'Eliminar opción', danger: true, confirmText: 'Eliminar', message: '¿Eliminar esta condición médica de las opciones del bot?' })) {
      await adminApi.delete(`/admin/conditions/${id}`); toast.success('Opción eliminada.'); load();
    }
  };
  const addCond = async () => { if (!nw.code || !nw.labelEs) return; await adminApi.post('/admin/conditions', nw); setNw({ code: '', labelEs: '', labelGn: '', sortOrder: 0 }); load(); };
  const saveSettings = async () => {
    setSavingS(true);
    try { await adminApi.put('/admin/settings', settings); toast.success('Precios guardados. Se aplican a las nuevas órdenes al instante.'); }
    catch { toast.error('No se pudieron guardar los precios.'); }
    finally { setSavingS(false); }
  };
  if (loading) return <Loading />;
  const priceKeys: [string, string][] = [
    ['price.py.monthly', 'PY · Mensual (Gs.)'], ['price.py.annual', 'PY · Anual (Gs.)'], ['price.py.fine', 'PY · Multa (Gs.)'],
    ['price.br.monthly', 'BR · Mensual (R$)'], ['price.br.annual', 'BR · Anual (R$)'], ['price.br.fine', 'BR · Multa (R$)'],
  ];
  return (
    <div className="space-y-4">
      <Section title="Precios de planes" icon={<DollarSign className="w-4 h-4" />}>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          {priceKeys.map(([k, label]) => (
            <div key={k}>
              <label className="text-[11px] font-semibold text-fg-muted">{label}</label>
              <input value={settings[k] ?? ''} onChange={(e) => setSettings({ ...settings, [k]: e.target.value })} inputMode="numeric"
                className={`${inputCls} w-full mt-1`} placeholder="(usa el valor por defecto si está vacío)" />
            </div>
          ))}
        </div>
        <button onClick={saveSettings} disabled={savingS} className="mt-3 px-4 py-2 rounded-xl bg-teal-500 text-slate-950 font-bold text-sm inline-flex items-center gap-2 disabled:opacity-50">
          {savingS ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Guardar precios
        </button>
      </Section>
      <Section title="Condiciones médicas (opciones del bot)" icon={<ListChecks className="w-4 h-4" />} bodyClassName="-mx-1">
        <div className="border border-line rounded-xl divide-y divide-line overflow-hidden">
          {conds.map((c) => (
            <div key={c.id} className="p-3 flex flex-wrap items-center gap-2">
              <span className="w-8 text-center font-mono text-fg-muted text-xs">{c.code}</span>
              <input defaultValue={c.labelEs} onBlur={(e) => e.target.value !== c.labelEs && patchCond(c.id, { labelEs: e.target.value })} className="flex-1 min-w-[120px] bg-panel border border-line rounded-lg px-2 py-1.5 text-xs text-fg" placeholder="Etiqueta ES" />
              <input defaultValue={c.labelGn} onBlur={(e) => e.target.value !== c.labelGn && patchCond(c.id, { labelGn: e.target.value })} className="flex-1 min-w-[120px] bg-panel border border-line rounded-lg px-2 py-1.5 text-xs text-fg" placeholder="Etiqueta GN" />
              <input type="number" defaultValue={c.sortOrder} onBlur={(e) => Number(e.target.value) !== c.sortOrder && patchCond(c.id, { sortOrder: Number(e.target.value) })} className="w-14 bg-panel border border-line rounded-lg px-2 py-1.5 text-xs text-fg" />
              <button onClick={() => patchCond(c.id, { active: !c.active })} className={`px-2 py-1 rounded-lg text-[11px] font-bold ${c.active ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300' : 'bg-muted text-fg-muted'}`}>{c.active ? 'Activo' : 'Oculto'}</button>
              <button onClick={() => delCond(c.id)} className="p-1.5 rounded-lg bg-rose-600/20 text-rose-600 dark:text-rose-400 hover:bg-rose-600/30"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
          ))}
          <div className="p-3 flex flex-wrap items-center gap-2 bg-panel/40">
            <input value={nw.code} onChange={(e) => setNw({ ...nw, code: e.target.value })} placeholder="Cód." className="w-16 bg-panel border border-line rounded-lg px-2 py-1.5 text-xs text-fg" />
            <input value={nw.labelEs} onChange={(e) => setNw({ ...nw, labelEs: e.target.value })} placeholder="Etiqueta ES" className="flex-1 min-w-[120px] bg-panel border border-line rounded-lg px-2 py-1.5 text-xs text-fg" />
            <input value={nw.labelGn} onChange={(e) => setNw({ ...nw, labelGn: e.target.value })} placeholder="Etiqueta GN" className="flex-1 min-w-[120px] bg-panel border border-line rounded-lg px-2 py-1.5 text-xs text-fg" />
            <input type="number" value={nw.sortOrder} onChange={(e) => setNw({ ...nw, sortOrder: Number(e.target.value) })} className="w-14 bg-panel border border-line rounded-lg px-2 py-1.5 text-xs text-fg" />
            <button onClick={addCond} className="px-3 py-1.5 rounded-lg bg-teal-500 text-slate-950 font-bold text-xs inline-flex items-center gap-1"><Plus className="w-3.5 h-3.5" />Agregar</button>
          </div>
        </div>
      </Section>
    </div>
  );
};

/* ─────────────────────────────────  IA  ──────────────────────────────── */

const SCOPES: { id: string; label: string }[] = [
  { id: 'GENERAL', label: 'General (base para todo)' },
  { id: 'PRE_REGISTRO', label: 'Antes de registrarse' },
  { id: 'MIEMBRO_ACTIVO', label: 'Miembro activo' },
];

const IA: React.FC = () => {
  const confirm = useConfirm();
  const toast = useToast();
  const [rows, setRows] = useState<any[]>([]);
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [nw, setNw] = useState({ name: '', scope: 'GENERAL', content: '', sortOrder: 0 });
  const [savingPrd, setSavingPrd] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([adminApi.get('/admin/ai-prompts'), adminApi.get('/admin/settings')])
      .then(([p, s]) => { setRows(p.data.rows || []); setSettings(s.data.settings || {}); })
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const patch = async (id: string, data: any) => { await adminApi.patch(`/admin/ai-prompts/${id}`, data); load(); };
  const del = async (id: string) => {
    if (await confirm({ title: 'Eliminar prompt', danger: true, confirmText: 'Eliminar', message: '¿Eliminar este prompt de IA? El bot dejará de usarlo.' })) {
      await adminApi.delete(`/admin/ai-prompts/${id}`); toast.success('Prompt eliminado.'); load();
    }
  };
  const add = async () => {
    if (!nw.name.trim() || !nw.content.trim()) { toast.error('Nombre y contenido son obligatorios.'); return; }
    await adminApi.post('/admin/ai-prompts', nw);
    setNw({ name: '', scope: 'GENERAL', content: '', sortOrder: 0 });
    toast.success('Prompt creado. El bot lo usa en ~1 min.');
    load();
  };
  const savePrd = async () => {
    setSavingPrd(true);
    try { await adminApi.put('/admin/settings', { 'prd.pendientes': settings['prd.pendientes'] || '' }); toast.success('Guardado.'); }
    catch { toast.error('No se pudo guardar.'); }
    finally { setSavingPrd(false); }
  };

  if (loading) return <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-fg-muted" /></div>;
  const inp = 'w-full bg-panel border border-line rounded-lg px-3 py-2 text-sm text-fg outline-none focus:border-teal-500';

  return (
    <div className="space-y-4">
      <Section title="Prompts de IA del asistente" icon={<Sparkles className="w-4 h-4" />}>
        <p className="text-xs text-fg-muted mb-3 -mt-1">
          El bot arma su instrucción concatenando los prompts <b>activos</b> de tipo <i>General</i> + los del momento del usuario
          (<i>antes de registrarse</i> o <i>miembro activo</i>). Se aplican en ~1 minuto, sin reiniciar nada.
        </p>
        <div className="space-y-3">
          {rows.map((p) => (
            <div key={p.id} className="bg-card border border-line rounded-2xl p-4 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <input defaultValue={p.name} onBlur={(e) => e.target.value !== p.name && patch(p.id, { name: e.target.value })}
                  className="flex-1 min-w-[160px] bg-panel border border-line rounded-lg px-2.5 py-1.5 text-sm font-bold text-fg" />
                <select defaultValue={p.scope} onChange={(e) => patch(p.id, { scope: e.target.value })}
                  className="bg-panel border border-line rounded-lg px-2 py-1.5 text-xs text-fg">
                  {SCOPES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
                <input type="number" defaultValue={p.sortOrder} onBlur={(e) => Number(e.target.value) !== p.sortOrder && patch(p.id, { sortOrder: Number(e.target.value) })}
                  className="w-14 bg-panel border border-line rounded-lg px-2 py-1.5 text-xs text-fg" title="Orden" />
                <button onClick={() => patch(p.id, { active: !p.active })}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-bold ${p.active ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300' : 'bg-muted text-fg-muted'}`}>
                  {p.active ? 'Activo' : 'Inactivo'}
                </button>
                <button onClick={() => del(p.id)} className="p-1.5 rounded-lg bg-rose-600/20 text-rose-600 dark:text-rose-400 hover:bg-rose-600/30"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
              <textarea defaultValue={p.content} rows={5}
                onBlur={(e) => e.target.value !== p.content && patch(p.id, { content: e.target.value })}
                className={`${inp} font-mono text-xs leading-relaxed`} />
            </div>
          ))}
        </div>

        <div className="bg-card border border-dashed border-line rounded-2xl p-4 mt-3 space-y-2">
          <p className="text-xs font-black text-fg-soft uppercase">Nuevo prompt</p>
          <div className="flex flex-wrap gap-2">
            <input value={nw.name} onChange={(e) => setNw({ ...nw, name: e.target.value })} placeholder="Nombre (ej. Preguntas frecuentes)" className="flex-1 min-w-[160px] bg-panel border border-line rounded-lg px-2.5 py-1.5 text-sm text-fg" />
            <select value={nw.scope} onChange={(e) => setNw({ ...nw, scope: e.target.value })} className="bg-panel border border-line rounded-lg px-2 py-1.5 text-xs text-fg">
              {SCOPES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
            <input type="number" value={nw.sortOrder} onChange={(e) => setNw({ ...nw, sortOrder: Number(e.target.value) })} className="w-14 bg-panel border border-line rounded-lg px-2 py-1.5 text-xs text-fg" title="Orden" />
          </div>
          <textarea value={nw.content} onChange={(e) => setNw({ ...nw, content: e.target.value })} rows={5} placeholder="Contenido / conocimiento que la IA debe usar para responder…" className={`${inp} font-mono text-xs`} />
          <button onClick={add} className="px-3.5 py-2 rounded-xl bg-teal-500 text-slate-950 font-bold text-sm inline-flex items-center gap-2"><Plus className="w-4 h-4" />Agregar prompt</button>
        </div>
      </Section>

      <Section title="Pendientes / lo que falta (PRD)" icon={<ListChecks className="w-4 h-4" />}>
        <p className="text-xs text-fg-muted mb-3 -mt-1">Bitácora editable de lo que todavía falta implementar del documento de producto. Solo referencia interna.</p>
        <textarea value={settings['prd.pendientes'] ?? ''} onChange={(e) => setSettings({ ...settings, 'prd.pendientes': e.target.value })}
          rows={16} className={`${inp} font-mono text-xs leading-relaxed`} placeholder="- [ ] …" />
        <button onClick={savePrd} disabled={savingPrd} className="mt-3 px-4 py-2 rounded-xl bg-teal-500 text-slate-950 font-bold text-sm inline-flex items-center gap-2 disabled:opacity-50">
          {savingPrd ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Guardar
        </button>
      </Section>
    </div>
  );
};

/* ───────────────────────────────  WhatsApp Bot  ─────────────────────────────── */

const ST_BADGE: Record<string, { cls: string; label: string }> = {
  received: { cls: 'bg-slate-500/15 text-fg-soft', label: 'recibido' },
  sent: { cls: 'bg-amber-500/15 text-amber-600 dark:text-amber-300', label: '⏳ enviado' },
  delivered: { cls: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300', label: '✅ entregado' },
  read: { cls: 'bg-teal-500/15 text-teal-600 dark:text-teal-300', label: '✅✅ leído' },
  failed: { cls: 'bg-rose-500/15 text-rose-600 dark:text-rose-300', label: '❌ falló' },
  skipped: { cls: 'bg-muted text-fg-muted', label: 'omitido' },
};

const Tile: React.FC<{ label: string; value: React.ReactNode; hint?: string; danger?: boolean }> = (p) => <Stat {...p} />;

const HIST_PAGE_SIZE = 15;

/* ── WhatsApp: SOLO conexión + herramientas de prueba + actividad en vivo ── */
const BotPanel: React.FC = () => {
  const toast = useToast();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [reconnecting, setReconnecting] = useState(false);
  const [fDir, setFDir] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [fPhone, setFPhone] = useState('');
  const [testPhone, setTestPhone] = useState('');
  const [testText, setTestText] = useState('');
  const [testBusy, setTestBusy] = useState(false);
  const [lookupPhone, setLookupPhone] = useState('');
  const [lookupRes, setLookupRes] = useState<any>(null);

  const load = useCallback(async () => {
    try {
      const { data } = await adminApi.get('/admin/bot/events', {
        params: { limit: 150, dir: fDir || undefined, status: fStatus || undefined, phone: fPhone || undefined },
      });
      setData(data);
    } catch {
      /* noop */
    } finally {
      setLoading(false);
    }
  }, [fDir, fStatus, fPhone]);

  useEffect(() => {
    load();
    const t = window.setInterval(load, 5000);
    return () => window.clearInterval(t);
  }, [load]);

  const reconnect = async () => {
    setReconnecting(true);
    try {
      await adminApi.post('/bot/reconnect', {});
      toast.success('Reconexión solicitada.');
    } catch {
      toast.error('No se pudo reconectar.');
    } finally {
      setReconnecting(false);
      setTimeout(load, 1500);
    }
  };

  const sendTest = async () => {
    const p = testPhone.replace(/\D/g, '');
    if (p.length < 7) { toast.error('Número inválido.'); return; }
    setTestBusy(true);
    try {
      const { data } = await adminApi.post('/admin/bot/send-test', { phone: p, text: testText || undefined });
      (data.ok ? toast.success('Mensaje de prueba enviado. Mirá el movimiento abajo.') : toast.error('El envío no salió.'));
      setTimeout(load, 1200);
    } catch {
      toast.error('Error al enviar.');
    } finally {
      setTestBusy(false);
    }
  };

  const doLookup = async () => {
    const p = lookupPhone.replace(/\D/g, '');
    if (p.length < 7) { toast.error('Número inválido.'); return; }
    setLookupRes({ loading: true });
    try {
      const { data } = await adminApi.get('/admin/bot/lookup', { params: { phone: p } });
      setLookupRes(data.result || { exists: false });
    } catch {
      setLookupRes({ error: true });
    }
  };

  const s = data?.status || {};
  const m = s.metrics || {};
  const events: any[] = data?.events || [];
  const lowDelivery = m.deliveryRate != null && m.outbound24h >= 5 && m.deliveryRate < 50;

  if (loading && !data) return <Loading />;

  return (
    <div className="space-y-4">
      {/* Estado de conexión */}
      <Card
        title="Conexión del bot"
        right={
          <button onClick={reconnect} disabled={reconnecting} className="px-3 py-1.5 rounded-lg bg-muted text-fg-soft text-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-50">
            {reconnecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Reconectar
          </button>
        }
      >
        <div className="flex flex-col sm:flex-row gap-4 items-start">
          <div className="flex-1 space-y-1.5 text-sm">
            <div className="flex items-center gap-2">
              {s.connected ? (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 text-xs font-black"><Wifi className="w-3.5 h-3.5" /> Conectado</span>
              ) : s.connecting ? (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-300 text-xs font-black"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Vinculando…</span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-rose-500/15 text-rose-600 dark:text-rose-300 text-xs font-black"><WifiOff className="w-3.5 h-3.5" /> Desconectado</span>
              )}
            </div>
            <div className="text-fg-muted text-xs">Número: <span className="font-mono text-fg">{s.meNumber || s.botNumber || '—'}</span> {s.meName ? `· ${s.meName}` : ''}</div>
            {s.sessionSince && <div className="text-fg-muted text-xs">Sesión activa desde {fdatetime(new Date(s.sessionSince).toISOString())}</div>}
            {s.lastError && <div className="text-rose-600 dark:text-rose-400 text-xs">Último error: {s.lastError}</div>}
            {s.gaveUp && <div className="text-rose-600 dark:text-rose-400 text-xs font-bold">El bot dejó de reintentar — reconectá manualmente.</div>}
          </div>
          {s.qrCode && (
            <div className="text-center">
              <img src={s.qrCode} alt="QR de vinculación" className="w-44 h-44 rounded-xl border border-line bg-white p-1.5" />
              <div className="text-[11px] text-fg-muted mt-1.5 max-w-[11rem]">Escaneá con WhatsApp → Dispositivos vinculados</div>
            </div>
          )}
        </div>
      </Card>

      {lowDelivery && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-300 text-xs font-bold">
          <AlertTriangle className="w-4 h-4 shrink-0" /> Tasa de entrega baja ({m.deliveryRate}%). La sesión puede estar re-armando el cifrado o el número tiene problemas.
        </div>
      )}

      {/* Tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Tile label="Entrantes 24h" value={m.inbound24h ?? 0} />
        <Tile label="Salientes 24h" value={m.outbound24h ?? 0} />
        <Tile label="Tasa de entrega" value={m.deliveryRate == null ? '—' : `${m.deliveryRate}%`} hint={`${m.delivered24h ?? 0} entregados`} danger={lowDelivery} />
        <Tile label="Fallos 24h" value={m.failed24h ?? 0} danger={(m.failed24h ?? 0) > 0} />
      </div>

      {/* Herramientas */}
      <div className="grid sm:grid-cols-2 gap-3">
        <Card title="Enviar mensaje de prueba">
          <div className="flex flex-wrap gap-2">
            <input value={testPhone} onChange={(e) => setTestPhone(e.target.value)} placeholder="595971…" className={`${inputCls} flex-1 min-w-[140px] font-mono`} />
            <input value={testText} onChange={(e) => setTestText(e.target.value)} placeholder="Texto (opcional)" className={`${inputCls} flex-1 min-w-[140px]`} />
            <button onClick={sendTest} disabled={testBusy} className="px-3 py-2 rounded-xl bg-teal-500 text-slate-950 text-xs font-black inline-flex items-center gap-1.5 disabled:opacity-50">
              {testBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} Enviar
            </button>
          </div>
        </Card>
        <Card title="¿El número está en WhatsApp?">
          <div className="flex flex-wrap gap-2 items-center">
            <input value={lookupPhone} onChange={(e) => setLookupPhone(e.target.value)} placeholder="595971…" className={`${inputCls} flex-1 min-w-[140px] font-mono`} />
            <button onClick={doLookup} className="px-3 py-2 rounded-xl bg-muted text-fg-soft text-xs font-bold inline-flex items-center gap-1.5"><Search className="w-3.5 h-3.5" /> Consultar</button>
          </div>
          {lookupRes && (
            <div className="mt-2 text-xs">
              {lookupRes.loading ? '…'
                : lookupRes.error ? <span className="text-rose-500">Error en la consulta</span>
                : lookupRes.exists === false ? <span className="text-rose-500">No está en WhatsApp</span>
                : <span className="text-emerald-600 dark:text-emerald-300">En WhatsApp · <span className="font-mono">{lookupRes.lid || lookupRes.jid}</span></span>}
            </div>
          )}
        </Card>
      </div>

      {/* Actividad reciente — el tail en vivo, para ver caer un mensaje de prueba.
          El registro completo (con filtros por fecha y borrado) está en la pestaña *Historial*. */}
      <Card
        title="Actividad reciente"
        right={<span className="text-[11px] text-fg-muted">últimos {events.length} · cada 5 s · registro completo en *Historial*</span>}
      >
        <div className="flex flex-wrap gap-2 mb-3">
          <select value={fDir} onChange={(e) => setFDir(e.target.value)} className={inputCls}>
            <option value="">Dirección</option><option value="in">📥 Entrante</option><option value="out">📤 Saliente</option><option value="sys">⚙ Sistema</option>
          </select>
          <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} className={inputCls}>
            <option value="">Estado</option><option value="sent">Enviado</option><option value="delivered">Entregado</option><option value="read">Leído</option><option value="failed">Falló</option><option value="received">Recibido</option>
          </select>
          <input value={fPhone} onChange={(e) => setFPhone(e.target.value)} placeholder="Filtrar por número…" className={`${inputCls} font-mono`} />
          <button onClick={load} className="px-3 py-2 bg-muted rounded-xl text-fg-soft"><RefreshCw className="w-4 h-4" /></button>
        </div>
        <div className="overflow-x-auto overscroll-x-contain rounded-xl border border-line/60 [-webkit-overflow-scrolling:touch]">
          <table className="w-full text-xs min-w-[680px]">
            <thead className="text-fg-muted">
              <tr className="text-left [&>th]:py-1.5 [&>th]:font-bold border-b border-line">
                <th>Hora</th><th>Dir</th><th>Número</th><th>Tipo</th><th>Mensaje</th><th>Estado</th>
              </tr>
            </thead>
            <tbody className="[&>tr]:border-b [&>tr]:border-line/60">
              {events.map((e) => (
                <tr key={e.id} className="[&>td]:py-1.5 align-top">
                  <td className="text-fg-muted whitespace-nowrap">{new Date(e.ts).toLocaleTimeString('es-PY')}</td>
                  <td>{e.dir === 'in' ? <ArrowDownLeft className="w-3.5 h-3.5 text-sky-500" /> : e.dir === 'out' ? <ArrowUpRight className="w-3.5 h-3.5 text-teal-500" /> : <Activity className="w-3.5 h-3.5 text-fg-muted" />}</td>
                  <td className="font-mono text-fg-soft whitespace-nowrap">{e.phone || (e.jid ? e.jid.split('@')[0] : '—')}</td>
                  <td className="text-fg-muted">{e.kind || '—'}</td>
                  <td className="max-w-[22rem]"><div className="truncate text-fg" title={e.preview}>{e.preview || '—'}</div>{e.error && <div className="text-rose-500 text-[11px]">{e.error}</div>}</td>
                  <td>{e.status ? <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold whitespace-nowrap ${(ST_BADGE[e.status] || ST_BADGE.skipped).cls}`}>{(ST_BADGE[e.status] || ST_BADGE.skipped).label}</span> : '—'}</td>
                </tr>
              ))}
              {!events.length && <tr><td colSpan={6} className="py-6 text-center text-fg-muted">Sin movimientos todavía.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>

    </div>
  );
};

/* ── Historial: SOLO el registro persistente de mensajes (pestaña aparte) ── */
const BotHistory: React.FC = () => {
  const toast = useToast();
  const confirm = useConfirm();
  const [hDir, setHDir] = useState('');
  const [hStatus, setHStatus] = useState('');
  const [hPhone, setHPhone] = useState('');
  const [hFrom, setHFrom] = useState('');
  const [hTo, setHTo] = useState('');
  const [hPage, setHPage] = useState(1);
  const [hData, setHData] = useState<{ total: number; rows: any[] } | null>(null);
  const [hLoading, setHLoading] = useState(true);
  const [hSelected, setHSelected] = useState<Set<string>>(new Set());
  const [hBusy, setHBusy] = useState(false);

  const loadHistory = useCallback(async () => {
    setHLoading(true);
    try {
      const { data } = await adminApi.get('/admin/bot/messages', {
        params: {
          page: hPage, pageSize: HIST_PAGE_SIZE,
          dir: hDir || undefined, status: hStatus || undefined, phone: hPhone || undefined,
          from: hFrom || undefined, to: hTo || undefined,
        },
      });
      setHData(data);
    } catch {
      toast.error('No se pudo cargar el historial.');
    } finally {
      setHLoading(false);
    }
  }, [hPage, hDir, hStatus, hPhone, hFrom, hTo]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadHistory(); }, [loadHistory]);
  useEffect(() => { setHPage(1); }, [hDir, hStatus, hPhone, hFrom, hTo]);
  useEffect(() => { setHSelected(new Set()); }, [hData]);

  const hTotal = hData?.total ?? 0;
  const hRows: any[] = hData?.rows || [];
  const hTotalPages = Math.max(1, Math.ceil(hTotal / HIST_PAGE_SIZE));
  const hFiltered = !!(hDir || hStatus || hPhone || hFrom || hTo);

  const toggleHSelected = (id: string) => {
    setHSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleHSelectAllPage = () => {
    setHSelected((prev) => (hRows.every((r) => prev.has(r.id)) ? new Set() : new Set(hRows.map((r) => r.id))));
  };
  const deleteHOne = async (id: string) => {
    if (!(await confirm({ title: 'Borrar mensaje', danger: true, confirmText: 'Borrar', message: 'Se borra permanentemente del historial.' }))) return;
    setHBusy(true);
    try { await adminApi.delete(`/admin/bot/messages/${id}`); toast.success('Mensaje borrado.'); loadHistory(); }
    catch { toast.error('No se pudo borrar.'); } finally { setHBusy(false); }
  };
  const deleteHSelected = async () => {
    const ids = Array.from(hSelected);
    if (!ids.length) return;
    if (!(await confirm({ title: 'Borrar seleccionados', danger: true, confirmText: `Borrar ${ids.length}`, message: `Se borran ${ids.length} mensaje(s) permanentemente.` }))) return;
    setHBusy(true);
    try { await adminApi.post('/admin/bot/messages/delete', { ids }); toast.success('Mensajes borrados.'); setHSelected(new Set()); loadHistory(); }
    catch { toast.error('No se pudo borrar.'); } finally { setHBusy(false); }
  };
  const deleteHAllFiltered = async () => {
    const ok = await confirm({
      title: 'Borrar historial', danger: true, confirmText: `Borrar los ${hTotal}`,
      message: hFiltered
        ? `Se borran los ${hTotal} mensajes que matchean el filtro actual (no solo esta página).`
        : `Sin filtros: se borran TODOS los ${hTotal} mensajes del historial. No se puede deshacer.`,
    });
    if (!ok) return;
    setHBusy(true);
    try {
      await adminApi.post('/admin/bot/messages/delete', {
        all: true, dir: hDir || undefined, status: hStatus || undefined, phone: hPhone || undefined, from: hFrom || undefined, to: hTo || undefined,
      });
      toast.success('Historial borrado.'); setHSelected(new Set()); loadHistory();
    } catch { toast.error('No se pudo borrar.'); } finally { setHBusy(false); }
  };

  return (
    <div className="space-y-4">
      <Card
        title="Historial de mensajes"
        right={<span className="text-[11px] text-fg-muted">{hTotal} en total{hFiltered ? ' (filtrado)' : ''}</span>}
      >
        <div className="flex flex-wrap gap-2 mb-3 items-center">
          <select value={hDir} onChange={(e) => setHDir(e.target.value)} className={inputCls}>
            <option value="">Dirección</option><option value="in">📥 Entrante</option><option value="out">📤 Saliente</option><option value="sys">⚙ Sistema</option>
          </select>
          <select value={hStatus} onChange={(e) => setHStatus(e.target.value)} className={inputCls}>
            <option value="">Estado</option>
            <option value="sent">⏳ Enviado</option>
            <option value="delivered">✅ Entregado</option>
            <option value="read">✅✅ Visto</option>
            <option value="received">📥 Recibido</option>
            <option value="failed">❌ Falló</option>
            <option value="skipped">Omitido</option>
          </select>
          <input value={hPhone} onChange={(e) => setHPhone(e.target.value)} placeholder="Filtrar por número…" className={`${inputCls} font-mono`} />
          <label className="flex items-center gap-1.5 text-[11px] text-fg-muted">Desde
            <input type="date" value={hFrom} onChange={(e) => setHFrom(e.target.value)} className={inputCls} />
          </label>
          <label className="flex items-center gap-1.5 text-[11px] text-fg-muted">Hasta
            <input type="date" value={hTo} onChange={(e) => setHTo(e.target.value)} className={inputCls} />
          </label>
          <button onClick={loadHistory} disabled={hLoading} className="px-3 py-2 bg-muted rounded-xl text-fg-soft disabled:opacity-50">
            <RefreshCw className={`w-4 h-4 ${hLoading ? 'animate-spin' : ''}`} />
          </button>
          {hFiltered && (
            <button onClick={() => { setHDir(''); setHStatus(''); setHPhone(''); setHFrom(''); setHTo(''); }} className="text-[11px] text-fg-muted underline">
              Limpiar filtros
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 mb-2">
          <button onClick={toggleHSelectAllPage} className="text-[11px] font-bold text-fg-soft px-2 py-1 rounded-lg bg-muted">
            {hRows.length && hRows.every((r) => hSelected.has(r.id)) ? 'Deseleccionar página' : 'Seleccionar página'}
          </button>
          <button onClick={deleteHSelected} disabled={!hSelected.size || hBusy}
            className="text-[11px] font-bold text-rose-600 dark:text-rose-400 px-2 py-1 rounded-lg bg-rose-500/10 disabled:opacity-40 inline-flex items-center gap-1">
            <Trash2 className="w-3 h-3" /> Borrar seleccionados ({hSelected.size})
          </button>
          <button onClick={deleteHAllFiltered} disabled={!hTotal || hBusy}
            className="text-[11px] font-bold text-rose-600 dark:text-rose-400 px-2 py-1 rounded-lg bg-rose-500/10 disabled:opacity-40 inline-flex items-center gap-1 ml-auto">
            <Trash2 className="w-3 h-3" /> Borrar {hFiltered ? 'lo filtrado' : 'todo'} ({hTotal})
          </button>
        </div>

        <div className="overflow-x-auto overscroll-x-contain rounded-xl border border-line/60 [-webkit-overflow-scrolling:touch]">
          <table className="w-full text-xs min-w-[680px]">
            <thead className="text-fg-muted">
              <tr className="text-left [&>th]:py-1.5 [&>th]:font-bold border-b border-line">
                <th className="w-6"></th><th>Fecha</th><th>Dir</th><th>Número</th><th>Tipo</th><th>Mensaje</th><th>Estado</th><th></th>
              </tr>
            </thead>
            <tbody className="[&>tr]:border-b [&>tr]:border-line/60">
              {hRows.map((m) => (
                <tr key={m.id} className="[&>td]:py-1.5 align-top">
                  <td><input type="checkbox" checked={hSelected.has(m.id)} onChange={() => toggleHSelected(m.id)} /></td>
                  <td className="text-fg-muted whitespace-nowrap">{new Date(m.ts).toLocaleString('es-PY')}</td>
                  <td>{m.dir === 'in' ? <ArrowDownLeft className="w-3.5 h-3.5 text-sky-500" /> : m.dir === 'out' ? <ArrowUpRight className="w-3.5 h-3.5 text-teal-500" /> : <Activity className="w-3.5 h-3.5 text-fg-muted" />}</td>
                  <td className="font-mono text-fg-soft whitespace-nowrap">{m.phone || (m.jid ? m.jid.split('@')[0] : '—')}</td>
                  <td className="text-fg-muted">{m.kind || '—'}</td>
                  <td className="max-w-[22rem]"><div className="whitespace-pre-wrap text-fg">{m.text || '—'}</div>{m.error && <div className="text-rose-500 text-[11px]">{m.error}</div>}</td>
                  <td>{m.status ? <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold whitespace-nowrap ${(ST_BADGE[m.status] || ST_BADGE.skipped).cls}`}>{(ST_BADGE[m.status] || ST_BADGE.skipped).label}</span> : '—'}</td>
                  <td><button onClick={() => deleteHOne(m.id)} disabled={hBusy} className="p-1 rounded bg-rose-600/15 text-rose-500 disabled:opacity-40"><Trash2 className="w-3 h-3" /></button></td>
                </tr>
              ))}
              {hLoading && <tr><td colSpan={8} className="py-6 text-center text-fg-muted"><Loader2 className="w-4 h-4 animate-spin inline" /></td></tr>}
              {!hLoading && !hRows.length && <tr><td colSpan={8} className="py-6 text-center text-fg-muted">Sin mensajes para este filtro.</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between mt-3 text-[11px] text-fg-muted">
          <span>Página {hPage} de {hTotalPages}</span>
          <div className="flex gap-2">
            <button onClick={() => setHPage((p) => Math.max(1, p - 1))} disabled={hPage <= 1 || hLoading} className="px-3 py-1.5 rounded-lg bg-muted text-fg-soft disabled:opacity-40">Anterior</button>
            <button onClick={() => setHPage((p) => Math.min(hTotalPages, p + 1))} disabled={hPage >= hTotalPages || hLoading} className="px-3 py-1.5 rounded-lg bg-muted text-fg-soft disabled:opacity-40">Siguiente</button>
          </div>
        </div>
      </Card>
    </div>
  );
};
