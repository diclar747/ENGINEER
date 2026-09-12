import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  HeartPulse,
  QrCode,
  CreditCard,
  Download,
  Bot,
  Lock,
  LogOut,
  X,
} from 'lucide-react';
import { ThemeToggle } from './ThemeToggle';

const NAV_ITEMS = [
  { label: 'Mi Pasaporte', path: '/dashboard', icon: HeartPulse },
  { label: 'Kit & QR', path: '/stickers', icon: QrCode },
  { label: 'Exportar', path: '/export', icon: Download },
  { label: 'Pagos', path: '/payments', icon: CreditCard },
  { label: 'Auditoría', path: '/audit-logs', icon: Lock },
  // /bot-simulator es la herramienta de depuración del ADMIN (puede impersonar
  // cualquier número) — redirige a /admin/login para cualquier visitante público.
  // El asistente público real, que hace el mismo trabajo que WhatsApp (responde,
  // guarda, registra) sin necesitar sesión de admin, es /registro.
  { label: 'Asistente Bot', path: '/registro', icon: Bot },
];

export const Navbar: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const token = localStorage.getItem('biopass_token');
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleLogout = () => {
    localStorage.removeItem('biopass_token');
    localStorage.removeItem('biopass_user');
    setMobileOpen(false);
    navigate('/login');
  };

  const isActive = (path: string) => location.pathname === path;

  return (
    <header className="border-b border-line/80 bg-app/90 backdrop-blur-xl sticky top-0 z-40 transition-all">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between gap-4 h-16 sm:h-18">
          {/* Brand */}
          <Link
            to="/"
            className="flex items-center gap-2.5 shrink-0 group select-none"
            onClick={() => setMobileOpen(false)}
          >
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-teal-500 via-cyan-400 to-emerald-400 p-0.5 shadow-lg shadow-teal-500/20 group-hover:scale-105 group-active:scale-95 transition-all">
              <div className="w-full h-full bg-panel rounded-[14px] flex items-center justify-center">
                <HeartPulse className="w-5 h-5 text-teal-600 dark:text-teal-400" />
              </div>
            </div>
            <div className="leading-none">
              <div className="flex items-center gap-1.5">
                <span className="text-[15px] sm:text-base font-black tracking-tight text-fg whitespace-nowrap">
                  BIO-PASS
                </span>
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-teal-500/15 border border-teal-500/30 text-teal-600 dark:text-teal-300">
                  HEALTH
                </span>
              </div>
              <p className="hidden sm:block mt-1 text-[9px] text-fg-muted font-medium tracking-[0.15em] whitespace-nowrap">
                PASAPORTE MÉDICO INTELIGENTE
              </p>
            </div>
          </Link>

          {/* Right actions */}
          <div className="flex items-center gap-2.5 shrink-0">
            <ThemeToggle />
            {token ? (
              <button
                onClick={handleLogout}
                className="hidden sm:flex items-center gap-1.5 text-xs font-semibold px-3.5 py-2 rounded-xl border border-line bg-muted/80 hover:bg-rose-50 dark:hover:bg-rose-950/40 hover:border-rose-500/40 text-fg-soft hover:text-rose-600 dark:text-rose-300 transition-all"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Cerrar Sesión</span>
              </button>
            ) : (
              <Link
                to="/login"
                className="text-xs font-bold px-4 py-2 sm:px-5 sm:py-2.5 rounded-xl bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 text-white shadow-md shadow-teal-500/25 transition-all hover:scale-105 active:scale-95"
              >
                Iniciar Sesión
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* Menú por FAB + bottom-sheet en TODOS los tamaños (no solo móvil) — el nav
          de arriba se sacó del todo, el mismo patrón que ya usa el panel
          autenticado (AppShell). */}
      {mobileOpen && (
        <>
          <div className="fixed inset-0 bg-black/45 z-40 animate-fade-in" onClick={() => setMobileOpen(false)} />
          <div className="fixed inset-x-0 bottom-0 z-50 bg-card rounded-t-3xl border-t border-line shadow-2xl animate-slide-up pb-[calc(0.5rem+var(--safe-bottom))] sm:inset-x-auto sm:right-6 sm:bottom-24 sm:w-80 sm:rounded-3xl sm:border">
            <div className="pt-3 pb-1 flex justify-center"><div className="w-10 h-1.5 rounded-full bg-line" /></div>
            <div className="px-4 pb-2 pt-1 flex items-center gap-2 border-b border-line/70">
              <HeartPulse className="w-4 h-4 text-teal-600 dark:text-teal-400" />
              <span className="font-black text-fg text-sm">Menú</span>
              <button type="button" onClick={() => setMobileOpen(false)} className="ml-auto p-1.5 rounded-lg text-fg-muted hover:bg-muted">
                <X className="w-4 h-4" />
              </button>
            </div>
            <nav className="p-2 max-h-[60vh] overflow-y-auto">
              {NAV_ITEMS.map(({ label, path, icon: Icon }) => (
                <Link
                  key={path}
                  to={path}
                  onClick={() => setMobileOpen(false)}
                  className={`flex items-center gap-3.5 px-3.5 py-3.5 rounded-2xl text-[15px] font-bold transition-colors ${
                    isActive(path)
                      ? 'bg-teal-500/12 text-teal-700 dark:text-teal-300'
                      : 'text-fg-soft hover:bg-muted active:bg-muted'
                  }`}
                >
                  <Icon className={`w-5 h-5 shrink-0 ${isActive(path) ? '' : 'text-fg-muted'}`} />
                  <span className="flex-1 text-left truncate">{label}</span>
                  {isActive(path) && <span className="w-1.5 h-1.5 rounded-full bg-teal-500" />}
                </Link>
              ))}
            </nav>
            {token && (
              <div className="px-3 pb-2 pt-1 border-t border-line/70">
                <button
                  onClick={handleLogout}
                  className="w-full flex items-center justify-center gap-2 text-sm font-bold py-3 rounded-2xl border border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-300 transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                  <span>Cerrar Sesión</span>
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {/* FAB — mismo look que el del panel autenticado (corazón, degradado
          teal→emerald, halo pulsante), en TODOS los tamaños de pantalla, siempre
          abajo. Oculto mientras el menú está abierto. */}
      {!mobileOpen && (
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label="Abrir menú"
          className="fixed right-4 sm:right-6 bottom-[calc(1rem+var(--safe-bottom))] sm:bottom-6 z-40 w-14 h-14 rounded-full bg-gradient-to-br from-teal-500 to-emerald-600 text-white shadow-xl shadow-emerald-600/35 flex items-center justify-center active:scale-90 transition-transform"
        >
          <span className="absolute inset-0 rounded-full bg-emerald-400/40 animate-ping [animation-duration:2.6s]" />
          <HeartPulse className="w-6 h-6 relative" />
        </button>
      )}
    </header>
  );
};
