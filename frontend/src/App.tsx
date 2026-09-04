import React from 'react';
import { Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom';
import { Navbar } from './components/Navbar';
import { MobileBottomNav } from './components/MobileBottomNav';
import { PwaInstallPrompt } from './components/PwaInstallPrompt';
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
import { AdminLogin } from './pages/AdminLogin';
import { AdminPanel } from './pages/AdminPanel';

/** Redirects to /login when there is no session token. */
const RequireAuth: React.FC = () => {
  const location = useLocation();
  const token = localStorage.getItem('biopass_token');
  if (!token) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return <Outlet />;
};

/** Shell with top navigation, mobile bottom navigation and global PWA prompt. */
const AppLayout: React.FC = () => (
  <div className="min-h-screen flex flex-col bg-app">
    <Navbar />
    <main className="flex-1">
      <Outlet />
    </main>
    <MobileBottomNav />
    <PwaInstallPrompt />
    <footer className="border-t border-line/80 py-6 mb-16 lg:mb-0 text-center text-[11px] text-fg-muted">
      Doorway Cortex Bio-Pass · Zero-Knowledge Health Passport · AES-256-GCM
    </footer>
  </div>
);

const App: React.FC = () => {
  return (
    <>
      <Routes>
        {/* Public emergency card — full screen, no chrome */}
        <Route path="/e/:token" element={<EmergencyView />} />
        <Route path="/admin/login" element={<AdminLogin />} />
        <Route path="/admin" element={<AdminPanel />} />

        {/* Full-screen, no chrome */}
        <Route path="/bot-simulator" element={<BotSimulator />} />
        <Route path="/registro" element={<Register />} />

        {/* Everything else shares the layout shell */}
        <Route element={<AppLayout />}>
          <Route path="/login" element={<Login />} />
          {/* Admin-only: WhatsApp bot pairing */}
          <Route path="/bot-connect" element={<BotConnect />} />
          <Route path="/checkout" element={<Checkout />} />

          {/* Authenticated user panel */}
          <Route element={<RequireAuth />}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/stickers" element={<QrStickerStudio />} />
            <Route path="/export" element={<HistoryExport />} />
            <Route path="/payments" element={<Payments />} />
            <Route path="/audit-logs" element={<AuditLogs />} />
          </Route>

          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </>
  );
};

export default App;
