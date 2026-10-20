import React from 'react';
import { Routes, Route, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { HeartPulse, QrCode, Download, CreditCard, Lock, Bot, LogOut, ShieldCheck, Settings as SettingsIcon, LifeBuoy } from 'lucide-react';
import { Navbar } from './components/Navbar';
import { SUPPORT_EMAIL, supportMailto } from './utils/support';
import { PwaInstallPrompt } from './components/PwaInstallPrompt';
import { ThemeToggle } from './components/ThemeToggle';
import { AppShell } from './components/ui/Layout';
import { VoiceAgent } from './components/VoiceAgent';
import { Landing } from './pages/Landing';
import { FeedbackProvider } from './components/ui/Feedback';
import { clearSessionPin } from './utils/pinSession';

const Login = React.lazy(() => import('./pages/Login').then((m) => ({ default: m.Login })));
const Register = React.lazy(() => import('./pages/Register').then((m) => ({ default: m.Register })));
const Dashboard = React.lazy(() => import('./pages/Dashboard').then((m) => ({ default: m.Dashboard })));
const Settings = React.lazy(() => import('./pages/Settings').then((m) => ({ default: m.Settings })));
const QrStickerStudio = React.lazy(() => import('./pages/QrStickerStudio').then((m) => ({ default: m.QrStickerStudio })));
const HistoryExport = React.lazy(() => import('./pages/HistoryExport').then((m) => ({ default: m.HistoryExport })));
const Payments = React.lazy(() => import('./pages/Payments').then((m) => ({ default: m.Payments })));
const AuditLogs = React.lazy(() => import('./pages/AuditLogs').then((m) => ({ default: m.AuditLogs })));
const BotSimulator = React.lazy(() => import('./pages/BotSimulator').then((m) => ({ default: m.BotSimulator })));
const BotConnect = React.lazy(() => import('./pages/BotConnect').then((m) => ({ default: m.BotConnect })));
const Checkout = React.lazy(() => import('./pages/Checkout').then((m) => ({ default: m.Checkout })));
const EmergencyView = React.lazy(() => import('./pages/EmergencyView').then((m) => ({ default: m.EmergencyView })));
const PushInvite = React.lazy(() => import('./pages/PushInvite').then((m) => ({ default: m.PushInvite })));
const AdminLogin = React.lazy(() => import('./pages/AdminLogin').then((m) => ({ default: m.AdminLogin })));
const AdminPanel = React.lazy(() => import('./pages/AdminPanel').then((m) => ({ default: m.AdminPanel })));

/** Redirects to /login when there is no session token. */
const RequireAuth: React.FC = () => {
  const location = useLocation();
  const token = localStorage.getItem('biopass_token');
  if (!token) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return <Outlet />;
};

/** Shell mínimo (top-nav) para páginas públicas: /login, /checkout. */
const AppLayout: React.FC = () => (
  <div className="min-h-screen flex flex-col bg-app">
    <Navbar />
    <main className="flex-1">
      <Outlet />
    </main>
    <PwaInstallPrompt />
    <footer className="border-t border-line/80 py-6 px-4 text-center text-[11px] text-fg-muted space-y-1.5">
      <p>
        ¿Necesitás ayuda? Soporte:{' '}
        <a href={supportMailto()} className="font-semibold text-teal-700 dark:text-teal-400 hover:underline break-all">
          {SUPPORT_EMAIL}
        </a>
      </p>
      <p>Doorway Cortex Bio-Pass · Zero-Knowledge Health Passport · AES-256-GCM</p>
    </footer>
  </div>
);

const USER_NAV = [
  { id: 'dashboard', label: 'Mi Pasaporte', icon: <HeartPulse className="w-[18px] h-[18px]" />, path: '/dashboard' },
  { id: 'stickers', label: 'Kit & QR', icon: <QrCode className="w-[18px] h-[18px]" />, path: '/stickers' },
  { id: 'export', label: 'Exportar historial', icon: <Download className="w-[18px] h-[18px]" />, path: '/export' },
  { id: 'payments', label: 'Pagos', icon: <CreditCard className="w-[18px] h-[18px]" />, path: '/payments' },
  { id: 'audit-logs', label: 'Auditoría', icon: <Lock className="w-[18px] h-[18px]" />, path: '/audit-logs' },
  { id: 'settings', label: 'Configuración', icon: <SettingsIcon className="w-[18px] h-[18px]" />, path: '/settings' },
  // Mismo asistente público (/registro) — un socio logueado también puede
  // preguntarle algo al bot desde acá, no solo desde afuera sin cuenta.
  { id: 'bot', label: 'Asistente Bot', icon: <Bot className="w-[18px] h-[18px]" />, path: '/registro' },
];

/** Shell con barra lateral para el área autenticada del titular. */
const UserShell: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const logout = () => {
    localStorage.removeItem('biopass_token');
    localStorage.removeItem('biopass_user');
    clearSessionPin();
    navigate('/login');
  };
  const active = USER_NAV.find((n) => location.pathname.startsWith(n.path));
  return (
    <AppShell
      brand={<><HeartPulse className="w-6 h-6 text-white shrink-0" /><span className="font-black text-white text-base">Bio-Pass</span></>}
      nav={[
        ...USER_NAV.map((n) => ({ id: n.id, label: n.label, icon: n.icon, active: active?.id === n.id, onClick: () => navigate(n.path) })),
        { id: 'support', label: 'Soporte', icon: <LifeBuoy className="w-[18px] h-[18px]" />, href: supportMailto('Soporte Bio-Pass') },
      ]}
      fab={<HeartPulse className="w-6 h-6" />}
      title={active?.label || 'Mi Pasaporte'}
      subtitle="Pasaporte médico inteligente"
      headerRight={
        <>
          <ThemeToggle />
          <button onClick={logout} className="flex items-center gap-1.5 text-xs font-bold text-fg-muted hover:text-fg px-2.5 py-1.5 rounded-lg hover:bg-muted">
            <LogOut className="w-4 h-4" /><span className="hidden sm:inline">Salir</span>
          </button>
        </>
      }
      footer={
        // Mismo pie en la barra lateral (degradado, desktop) y en el menú del celular
        // (fondo claro): el texto blanco solo en lg+, si no quedaba invisible en el celular.
        <button onClick={logout} className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-bold text-fg-soft hover:bg-muted lg:text-white/80 lg:hover:bg-white/10 lg:hover:text-white transition-colors">
          <LogOut className="w-4 h-4" /> Cerrar sesión
        </button>
      }
    >
      <Outlet />
      <PwaInstallPrompt />
      <VoiceAgent />
    </AppShell>
  );
};

const App: React.FC = () => {
  return (
    <FeedbackProvider>
      <React.Suspense fallback={<div className="min-h-screen bg-app flex items-center justify-center" role="status" aria-label="Cargando página"><HeartPulse className="w-8 h-8 text-teal-600 animate-pulse" /></div>}>
      <Routes>
        {/* Public emergency card — full screen, no chrome */}
        <Route path="/e/:token" element={<EmergencyView />} />
        {/* Link que manda el bot por WhatsApp para activar push sin necesitar login/PIN */}
        <Route path="/push/:token" element={<PushInvite />} />
        <Route path="/admin/login" element={<AdminLogin />} />
        <Route path="/admin" element={<AdminPanel />} />
        {/* Admin-only, full-screen (sin barra de usuario). BotConnect/BotSimulator
            redirigen a /admin/login si no hay sesión de admin. */}
        <Route path="/admin/bot-connect" element={<BotConnect />} />
        <Route path="/bot-connect" element={<BotConnect />} />
        <Route path="/admin/bot-simulator" element={<BotSimulator />} />

        {/* Full-screen, no chrome */}
        <Route path="/bot-simulator" element={<BotSimulator />} />
        <Route path="/registro" element={<Register />} />
        <Route path="/" element={<Landing />} />

        {/* Páginas públicas con top-nav */}
        <Route element={<AppLayout />}>
          <Route path="/login" element={<Login />} />
          <Route path="/checkout" element={<Checkout />} />
        </Route>

        {/* Área autenticada del titular — shell con barra lateral */}
        <Route element={<RequireAuth />}>
          <Route element={<UserShell />}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/stickers" element={<QrStickerStudio />} />
            <Route path="/export" element={<HistoryExport />} />
            <Route path="/payments" element={<Payments />} />
            <Route path="/audit-logs" element={<AuditLogs />} />
            <Route path="/settings" element={<Settings />} />
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </React.Suspense>
    </FeedbackProvider>
  );
};

export default App;
