import React from 'react';
import { Routes, Route, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { HeartPulse, QrCode, Download, CreditCard, Lock, Bot, LogOut, ShieldCheck } from 'lucide-react';
import { Navbar } from './components/Navbar';
import { PwaInstallPrompt } from './components/PwaInstallPrompt';
import { ThemeToggle } from './components/ThemeToggle';
import { AppShell } from './components/ui/Layout';
import { Login } from './pages/Login';
import { Register } from './pages/Register';
import { Dashboard } from './pages/Dashboard';
import { QrStickerStudio } from './pages/QrStickerStudio';
import { HistoryExport } from './pages/HistoryExport';
import { Payments } from './pages/Payments';
import { AuditLogs } from './pages/AuditLogs';
import { BotSimulator } from './pages/BotSimulator';
import { BotConnect } from './pages/BotConnect';
import { Checkout } from './pages/Checkout';
import { EmergencyView } from './pages/EmergencyView';
import { PushInvite } from './pages/PushInvite';
import { AdminLogin } from './pages/AdminLogin';
import { AdminPanel } from './pages/AdminPanel';
import { FeedbackProvider } from './components/ui/Feedback';

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
    <footer className="border-t border-line/80 py-6 text-center text-[11px] text-fg-muted">
      Doorway Cortex Bio-Pass · Zero-Knowledge Health Passport · AES-256-GCM
    </footer>
  </div>
);

const USER_NAV = [
  { id: 'dashboard', label: 'Mi Pasaporte', icon: <HeartPulse className="w-[18px] h-[18px]" />, path: '/dashboard' },
  { id: 'stickers', label: 'Kit & QR', icon: <QrCode className="w-[18px] h-[18px]" />, path: '/stickers' },
  { id: 'export', label: 'Exportar historial', icon: <Download className="w-[18px] h-[18px]" />, path: '/export' },
  { id: 'payments', label: 'Pagos', icon: <CreditCard className="w-[18px] h-[18px]" />, path: '/payments' },
  { id: 'audit-logs', label: 'Auditoría', icon: <Lock className="w-[18px] h-[18px]" />, path: '/audit-logs' },
];

/** Shell con barra lateral para el área autenticada del titular. */
const UserShell: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const logout = () => {
    localStorage.removeItem('biopass_token');
    localStorage.removeItem('biopass_user');
    navigate('/login');
  };
  const active = USER_NAV.find((n) => location.pathname.startsWith(n.path));
  return (
    <AppShell
      brand={<><HeartPulse className="w-6 h-6 text-white shrink-0" /><span className="font-black text-white text-base">Bio-Pass</span></>}
      nav={USER_NAV.map((n) => ({ id: n.id, label: n.label, icon: n.icon, active: active?.id === n.id, onClick: () => navigate(n.path) }))}
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
        <button onClick={logout} className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-bold text-white/80 hover:bg-white/10 hover:text-white transition-colors">
          <LogOut className="w-4 h-4" /> Cerrar sesión
        </button>
      }
    >
      <Outlet />
      <PwaInstallPrompt />
    </AppShell>
  );
};

const App: React.FC = () => {
  return (
    <FeedbackProvider>
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
          </Route>
        </Route>

        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </FeedbackProvider>
  );
};

export default App;
