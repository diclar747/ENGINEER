import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { adminApi } from '../utils/adminApi';
import { ThemeToggle } from '../components/ThemeToggle';
import {
  ShieldCheck, LogOut, Users, CreditCard, ListChecks, LayoutDashboard,
  Loader2, Search, Check, X, RefreshCw, Plus, Trash2, Save, Smartphone,
} from 'lucide-react';

type Tab = 'resumen' | 'clientes' | 'pagos' | 'contenido';
const money = (n: number) => new Intl.NumberFormat('es-PY').format(Number(n) || 0);
const fdate = (s?: string) => (s ? new Date(s).toLocaleDateString() : '—');
const STATUS: Record<string, string> = {
  ACTIVE: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300', PENDING_PAYMENT: 'bg-amber-500/15 text-amber-600 dark:text-amber-300',
  EXPIRED: 'bg-slate-500/15 text-fg-soft', CANCELLED: 'bg-rose-500/15 text-rose-600 dark:text-rose-300',
  PURGED: 'bg-muted text-fg-muted', PAID: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300',
  PENDING: 'bg-amber-500/15 text-amber-600 dark:text-amber-300', FAILED: 'bg-rose-500/15 text-rose-600 dark:text-rose-300',
};
const Loading: React.FC = () => (<div className="py-16 text-center"><Loader2 className="w-6 h-6 animate-spin inline text-teal-600 dark:text-teal-400" /></div>);
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
    { id: 'pagos', label: 'Pagos', icon: <CreditCard className="w-4 h-4" /> },
    { id: 'contenido', label: 'Contenido', icon: <ListChecks className="w-4 h-4" /> },
  ];
  return (
    <div className="min-h-screen bg-app text-fg">
      <header className="sticky top-0 z-20 bg-card/95 backdrop-blur border-b border-line px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2.5"><ShieldCheck className="w-5 h-5 text-teal-600 dark:text-teal-400" /><span className="font-black text-fg text-sm sm:text-base">Bio-Pass · Admin</span></div>
        <div className="flex items-center gap-2.5">
          <button onClick={() => navigate('/bot-connect')} className="flex items-center gap-1.5 text-xs font-bold text-fg-muted hover:text-teal-500" title="Vincular bot de WhatsApp"><Smartphone className="w-4 h-4" /><span className="hidden sm:inline">WhatsApp</span></button>
          <ThemeToggle />
          <button onClick={logout} className="flex items-center gap-1.5 text-xs font-bold text-fg-muted hover:text-fg"><LogOut className="w-4 h-4" />Salir</button>
        </div>
      </header>
      <nav className="px-3 sm:px-4 pt-3 flex gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
        {tab === 'pagos' && <Pagos />}
        {tab === 'contenido' && <Contenido />}
      </main>
    </div>
  );
};

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

const Clientes: React.FC = () => {
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const load = useCallback(() => {
    setLoading(true);
    adminApi.get('/admin/users', { params: { page, search, status } })
      .then((r) => { setRows(r.data.rows); setTotal(r.data.total); }).finally(() => setLoading(false));
  }, [page, search, status]);
  useEffect(() => { load(); }, [load]);
  const setUserStatus = async (id: string, st: string) => { await adminApi.patch(`/admin/users/${id}/status`, { status: st }); load(); };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="w-4 h-4 text-fg-muted absolute left-3 top-2.5" />
          <input value={search} onChange={(e) => { setPage(1); setSearch(e.target.value); }} placeholder="Buscar nombre, teléfono, CI…"
            className="w-full pl-9 pr-3 py-2 bg-card border border-line rounded-xl text-sm text-fg outline-none focus:border-teal-500" />
        </div>
        <select value={status} onChange={(e) => { setPage(1); setStatus(e.target.value); }} className="bg-card border border-line rounded-xl text-sm text-fg px-3 py-2 outline-none">
          <option value="">Todos</option><option value="ACTIVE">Activos</option><option value="PENDING_PAYMENT">Pendiente pago</option><option value="EXPIRED">Vencidos</option><option value="CANCELLED">Cancelados</option>
        </select>
        <button onClick={load} className="px-3 py-2 bg-muted rounded-xl text-fg-soft hover:bg-muted"><RefreshCw className="w-4 h-4" /></button>
      </div>
      <div className="overflow-x-auto bg-card border border-line rounded-2xl">
        <table className="w-full text-xs">
          <thead className="text-fg-muted border-b border-line"><tr>{['Nombre', 'Teléfono', 'CI', 'Estado', 'Plan', 'Vence', 'Est.', 'Acciones'].map((h) => (<th key={h} className="text-left font-semibold px-3 py-2.5 whitespace-nowrap">{h}</th>))}</tr></thead>
          <tbody>
            {loading && (<tr><td colSpan={8} className="px-3 py-8 text-center"><Loader2 className="w-5 h-5 animate-spin inline text-teal-600 dark:text-teal-400" /></td></tr>)}
            {!loading && rows.length === 0 && (<tr><td colSpan={8} className="px-3 py-8 text-center text-fg-muted">Sin resultados</td></tr>)}
            {!loading && rows.map((u) => (
              <tr key={u.id} className="border-b border-line/60 hover:bg-muted/30">
                <td className="px-3 py-2.5 font-semibold text-fg whitespace-nowrap">{u.fullName || '—'}</td>
                <td className="px-3 py-2.5 font-mono whitespace-nowrap">{u.phoneNumber}</td>
                <td className="px-3 py-2.5 whitespace-nowrap">{u.ciNumber || '—'}</td>
                <td className="px-3 py-2.5"><span className={`px-2 py-0.5 rounded-full font-bold ${STATUS[u.status] || 'bg-muted'}`}>{u.status}</span></td>
                <td className="px-3 py-2.5 whitespace-nowrap">{u.subscriptions?.[0]?.plan || '—'}</td>
                <td className="px-3 py-2.5 whitespace-nowrap">{fdate(u.subscriptions?.[0]?.expiryDate)}</td>
                <td className="px-3 py-2.5 text-center">{u._count?.medicalStudies ?? 0}</td>
                <td className="px-3 py-2.5 whitespace-nowrap">
                  {u.status !== 'ACTIVE'
                    ? (<button onClick={() => setUserStatus(u.id, 'ACTIVE')} className="px-2.5 py-1 rounded-lg bg-emerald-600/80 hover:bg-emerald-600 text-white font-bold inline-flex items-center gap-1"><Check className="w-3 h-3" />Activar</button>)
                    : (<button onClick={() => setUserStatus(u.id, 'CANCELLED')} className="px-2.5 py-1 rounded-lg bg-rose-600/70 hover:bg-rose-600 text-white font-bold inline-flex items-center gap-1"><X className="w-3 h-3" />Suspender</button>)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager page={page} total={total} onPage={setPage} />
    </div>
  );
};

const Pagos: React.FC = () => {
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const load = useCallback(() => {
    setLoading(true);
    adminApi.get('/admin/payments', { params: { page, status } })
      .then((r) => { setRows(r.data.rows); setTotal(r.data.total); }).finally(() => setLoading(false));
  }, [page, status]);
  useEffect(() => { load(); }, [load]);
  const markPaid = async (ref: string) => {
    if (!window.confirm('¿Marcar como pagada y activar el Bio-Pass?')) return;
    await adminApi.post(`/admin/payments/${encodeURIComponent(ref)}/mark-paid`); load();
  };
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <select value={status} onChange={(e) => { setPage(1); setStatus(e.target.value); }} className="bg-card border border-line rounded-xl text-sm text-fg px-3 py-2 outline-none">
          <option value="">Todos</option><option value="PENDING">Pendientes</option><option value="PAID">Pagados</option><option value="EXPIRED">Vencidos</option><option value="FAILED">Fallidos</option>
        </select>
        <button onClick={load} className="px-3 py-2 bg-muted rounded-xl text-fg-soft hover:bg-muted"><RefreshCw className="w-4 h-4" /></button>
      </div>
      <div className="overflow-x-auto bg-card border border-line rounded-2xl">
        <table className="w-full text-xs">
          <thead className="text-fg-muted border-b border-line"><tr>{['Fecha', 'Cliente', 'Gateway', 'Método', 'Monto', 'Estado', 'Ref', ''].map((h) => (<th key={h} className="text-left font-semibold px-3 py-2.5 whitespace-nowrap">{h}</th>))}</tr></thead>
          <tbody>
            {loading && (<tr><td colSpan={8} className="px-3 py-8 text-center"><Loader2 className="w-5 h-5 animate-spin inline text-teal-600 dark:text-teal-400" /></td></tr>)}
            {!loading && rows.length === 0 && (<tr><td colSpan={8} className="px-3 py-8 text-center text-fg-muted">Sin pagos</td></tr>)}
            {!loading && rows.map((p) => (
              <tr key={p.id} className="border-b border-line/60 hover:bg-muted/30">
                <td className="px-3 py-2.5 whitespace-nowrap">{fdate(p.createdAt)}</td>
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

const Contenido: React.FC = () => {
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
  const delCond = async (id: string) => { if (window.confirm('¿Eliminar esta opción?')) { await adminApi.delete(`/admin/conditions/${id}`); load(); } };
  const addCond = async () => { if (!nw.code || !nw.labelEs) return; await adminApi.post('/admin/conditions', nw); setNw({ code: '', labelEs: '', labelGn: '', sortOrder: 0 }); load(); };
  const saveSettings = async () => { setSavingS(true); try { await adminApi.put('/admin/settings', settings); } finally { setSavingS(false); } };
  if (loading) return <Loading />;
  const priceKeys: [string, string][] = [
    ['price.py.monthly', 'PY · Mensual (Gs.)'], ['price.py.annual', 'PY · Anual (Gs.)'], ['price.py.fine', 'PY · Multa (Gs.)'],
    ['price.br.monthly', 'BR · Mensual (R$)'], ['price.br.annual', 'BR · Anual (R$)'], ['price.br.fine', 'BR · Multa (R$)'],
  ];
  return (
    <div className="space-y-6">
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
        <p className="text-[11px] text-fg-muted mt-1.5">Se aplican al bot en el próximo deploy del backend (falta el refactor — Bloque B).</p>
      </section>
      <section>
        <h3 className="text-sm font-black text-fg mb-2">Precios de planes</h3>
        <div className="bg-card border border-line rounded-2xl p-4 grid grid-cols-2 lg:grid-cols-3 gap-3">
          {priceKeys.map(([k, label]) => (
            <div key={k}>
              <label className="text-[11px] font-semibold text-fg-muted">{label}</label>
              <input value={settings[k] ?? ''} onChange={(e) => setSettings({ ...settings, [k]: e.target.value })} className="w-full mt-1 bg-panel border border-line rounded-lg px-3 py-2 text-sm text-fg" />
            </div>
          ))}
        </div>
        <button onClick={saveSettings} disabled={savingS} className="mt-3 px-4 py-2 rounded-xl bg-teal-500 text-slate-950 font-bold text-sm inline-flex items-center gap-2 disabled:opacity-50">
          {savingS ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Guardar precios
        </button>
      </section>
    </div>
  );
};
