import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  ShieldCheck,
  HeartPulse,
  QrCode,
  CreditCard,
  Download,
  Bot,
  Lock,
  LogOut,
  Menu,
  X,
  Smartphone,
  Sparkles,
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

          {/* Desktop nav */}
          <nav className="hidden lg:flex items-center gap-1 flex-1 justify-center max-w-2xl">
            {NAV_ITEMS.map(({ label, path, icon: Icon }) => (
              <Link
                key={path}
                to={path}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-[13px] font-semibold whitespace-nowrap transition-all duration-200 ${
                  isActive(path)
                    ? 'bg-teal-500/15 text-teal-600 dark:text-teal-300 border border-teal-500/30 shadow-sm'
                    : 'text-fg-soft hover:text-fg hover:bg-muted/60 border border-transparent'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{label}</span>
              </Link>
            ))}
          </nav>

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

            {/* Mobile toggle */}
            <button
              onClick={() => setMobileOpen((v) => !v)}
              className="lg:hidden p-2.5 rounded-xl border border-line bg-muted/90 text-fg-soft hover:text-fg transition-colors"
              aria-label="Abrir menú"
            >
              {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Mobile nav drawer */}
        {mobileOpen && (
          <nav className="lg:hidden pb-5 pt-2 border-t border-line/80 grid grid-cols-2 gap-2 animate-fadeIn">
            {NAV_ITEMS.map(({ label, path, icon: Icon }) => (
              <Link
                key={path}
                to={path}
                onClick={() => setMobileOpen(false)}
                className={`flex items-center gap-2.5 px-3.5 py-3 rounded-xl text-xs font-semibold transition-all ${
                  isActive(path)
                    ? 'bg-teal-500/15 text-teal-600 dark:text-teal-300 border border-teal-500/30'
                    : 'text-fg-soft hover:text-fg bg-panel/60 border border-line/80'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0 text-teal-600 dark:text-teal-400" />
                <span className="truncate">{label}</span>
              </Link>
            ))}
            {token && (
              <button
                onClick={handleLogout}
                className="col-span-2 mt-1 flex items-center justify-center gap-2 text-xs font-bold py-3 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-300 transition-colors"
              >
                <LogOut className="w-4 h-4" />
                <span>Cerrar Sesión</span>
              </button>
            )}
          </nav>
        )}
      </div>
    </header>
  );
};
