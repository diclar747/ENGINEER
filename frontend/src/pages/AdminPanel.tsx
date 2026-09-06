import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { adminApi } from '../utils/adminApi';
import { ThemeToggle } from '../components/ThemeToggle';
import { useConfirm, useToast } from '../components/ui/Feedback';
import {
  ShieldCheck, LogOut, Users, CreditCard, ListChecks, LayoutDashboard, CalendarClock,
  Loader2, Search, Check, X, RefreshCw, Plus, Trash2, Save, Smartphone, Download, Printer,
  KeyRound, Unlock, CalendarPlus, Pencil, ExternalLink,
} from 'lucide-react';

type Tab = 'resumen' | 'clientes' | 'suscripciones' | 'pagos' | 'contenido';
const money = (n: number) => new Intl.NumberFormat('es-PY').format(Number(n) || 0);
const fdate = (s?: string) => (s ? new Date(s).toLocaleDateString('es-PY') : '—');
const fdatetime = (s?: string) => (s ? new Date(s).toLocaleString('es-PY') : '—');
const STATUS: Record<string, string> = {
  ACTIVE: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300', PENDING_PAYMENT: 'bg-amber-500/15 text-amber-600 dark:text-amber-300',
  EXPIRED: 'bg-slate-500/15 text-fg-soft', CANCELLED: 'bg-rose-500/15 text-rose-600 dark:text-rose-300',
  PURGED: 'bg-muted text-fg-muted', PAID: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300',
  PENDING: 'bg-amber-500/15 text-amber-600 dark:text-amber-300', FAILED: 'bg-rose-500/15 text-rose-600 dark:text-rose-300',
};
const GATEWAYS = ['BANCARD', 'PIX', 'MERCADOPAGO', 'BANK_TRANSFER', 'TIGO_MONEY', 'WINSAP'];
const Loading: React.FC = () => (<div className="py-16 text-center"><Loader2 className="w-6 h-6 animate-spin inline text-teal-600 dark:text-teal-400" /></div>);
const inputCls = 'bg-card border border-line rounded-xl text-sm text-fg px-3 py-2 outline-none focus:border-teal-500';

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
  ];
  return (
    <div className="min-h-screen bg-app text-fg">
      <header className="sticky top-0 z-20 bg-card/95 backdrop-blur border-b border-line px-4 py-3 flex items-center justify-between print:hidden">
        <div className="flex items-center gap-2.5"><ShieldCheck className="w-5 h-5 text-teal-600 dark:text-teal-400" /><span className="font-black text-fg text-sm sm:text-base">Bio-Pass · Admin</span></div>
        <div className="flex items-center gap-2.5">
          <button onClick={() => navigate('/bot-connect')} className="flex items-center gap-1.5 text-xs font-bold text-fg-muted hover:text-teal-500" title="Vincular bot de WhatsApp"><Smartphone className="w-4 h-4" /><span className="hidden sm:inline">WhatsApp</span></button>
          <ThemeToggle />
          <button onClick={logout} className="flex items-center gap-1.5 text-xs font-bold text-fg-muted hover:text-fg"><LogOut className="w-4 h-4" />Salir</button>
        </div>
      </header>
      <nav className="px-3 sm:px-4 pt-3 flex gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden print:hidden">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold shrink-0 transition-colors ${tab === t.id ? 'bg-teal-500 text-slate-950' : 'bg-muted/70 text-fg-soft hover:bg-muted'}`}>
            {t.icon}{t.label}
          </button>
        ))}
      </nav>
      <main className="p-3 sm:p-4 max-w-6xl mx-auto">
        {tab === 'resumen' && <Resumen />}
        {tab === 'clientes' && <Clientes />}
        {tab === 'suscripciones' && <Suscripciones />}
        {tab === 'pagos' && <Pagos />}
        {tab === 'contenido' && <Contenido />}
      </main>
    </div>
  );
};

/* ───────────────────────────────  Resumen  ─────────────────────────────── */

const Resumen: React.FC = () => {
  const [s, setS] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { adminApi.get('/admin/stats').then((r) => setS(r.data)).catch((e) => setErr(e?.response?.data?.error || 'Error')); }, []);
  if (err) return <p className="text-rose-600 dark:text-rose-400 text-sm">{err}</p>;
  if (!s) return <Loading />;
  const cards: [string, React.ReactNode][] = [
    ['Clientes', s.users], ['Activos', s.active], ['Pendientes de pago', s.pending],
    ['Pagos acreditados', s.paidOrders], ['Pagos pendientes', s.pendingOrders],
    ['Estudios cargados', s.studies], ['Ingresos (Gs.)', money(s.revenue)],
  ];
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {cards.map(([label, val]) => (
        <div key={label} className="bg-card border border-line rounded-2xl p-4">
          <p className="text-[11px] font-semibold text-fg-muted uppercase tracking-wide">{label}</p>
          <p className="text-2xl font-black text-fg mt-1">{val}</p>
        </div>
      ))}
    </div>
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
          <Search className="w-4 h-4 text-fg-muted absolute left-3 top-2.5" />
          <input value={search} onChange={(e) => { setPage(1); setSearch(e.target.value); }} placeholder="Buscar nombre, teléfono, CI…"
            className="w-full pl-9 pr-3 py-2 bg-card border border-line rounded-xl text-sm text-fg outline-none focus:border-teal-500" />
        </div>
        <select value={status} onChange={(e) => { setPage(1); setStatus(e.target.value); }} className={inputCls}>
          <option value="">Todos</option><option value="ACTIVE">Activos</option><option value="PENDING_PAYMENT">Pendiente pago</option><option value="EXPIRED">Vencidos</option><option value="CANCELLED">Cancelados</option>
        </select>
        <button onClick={load} className="px-3 py-2 bg-muted rounded-xl text-fg-soft hover:bg-muted"><RefreshCw className="w-4 h-4" /></button>
      </div>
      <div className="overflow-x-auto bg-card border border-line rounded-2xl">
        <table className="w-full text-xs">
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
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const load = useCallback(() => {
    setLoading(true);
    adminApi.get('/admin/subscriptions', { params: { page, filter } })
      .then((r) => { setRows(r.data.rows); setTotal(r.data.total); }).finally(() => setLoading(false));
  }, [page, filter]);
  useEffect(() => { load(); }, [load]);
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <select value={filter} onChange={(e) => { setPage(1); setFilter(e.target.value); }} className={inputCls}>
          <option value="all">Todas</option><option value="active">Activas</option><option value="expiring">Vencen en 7 días</option><option value="expired">Vencidas / canceladas</option>
        </select>
        <button onClick={load} className="px-3 py-2 bg-muted rounded-xl text-fg-soft"><RefreshCw className="w-4 h-4" /></button>
      </div>
      <div className="overflow-x-auto bg-card border border-line rounded-2xl">
        <table className="w-full text-xs">
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

      <div className="overflow-x-auto bg-card border border-line rounded-2xl">
        <table className="w-full text-xs">
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
    <div className="space-y-6">
      <section>
        <h3 className="text-sm font-black text-fg mb-2">Precios de planes</h3>
        <div className="bg-card border border-line rounded-2xl p-4 grid grid-cols-2 lg:grid-cols-3 gap-3">
          {priceKeys.map(([k, label]) => (
            <div key={k}>
              <label className="text-[11px] font-semibold text-fg-muted">{label}</label>
              <input value={settings[k] ?? ''} onChange={(e) => setSettings({ ...settings, [k]: e.target.value })} inputMode="numeric"
                className="w-full mt-1 bg-panel border border-line rounded-lg px-3 py-2 text-sm text-fg" placeholder="(usa el valor por defecto si está vacío)" />
            </div>
          ))}
        </div>
        <button onClick={saveSettings} disabled={savingS} className="mt-3 px-4 py-2 rounded-xl bg-teal-500 text-slate-950 font-bold text-sm inline-flex items-center gap-2 disabled:opacity-50">
          {savingS ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Guardar precios
        </button>
      </section>
      <section>
        <h3 className="text-sm font-black text-fg mb-2">Condiciones médicas (opciones del bot)</h3>
        <div className="bg-card border border-line rounded-2xl divide-y divide-line">
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
      </section>
    </div>
  );
};
