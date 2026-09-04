import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { HeartPulse, QrCode, CreditCard, Download, Bot, User } from 'lucide-react';

export const MobileBottomNav: React.FC = () => {
  const location = useLocation();
  const token = localStorage.getItem('biopass_token');

  // If no session token or on public emergency view, hide bottom nav
  if (!token || location.pathname.startsWith('/e/')) {
    return null;
  }

  const navItems = [
    { label: 'Pasaporte', path: '/dashboard', icon: HeartPulse },
    { label: 'Kit QR', path: '/stickers', icon: QrCode },
    { label: 'Pagos', path: '/payments', icon: CreditCard },
    { label: 'Exportar', path: '/export', icon: Download },
    { label: 'Asistente', path: '/bot-simulator', icon: Bot },
  ];

  return (
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-30 bg-app/95 backdrop-blur-xl border-t border-line/80 px-2 py-1.5 pb-safe shadow-[0_-8px_30px_rgba(0,0,0,0.5)]">
      <div className="flex items-center justify-around">
        {navItems.map(({ label, path, icon: Icon }) => {
          const active = location.pathname === path;
          return (
            <Link
              key={path}
              to={path}
              className={`flex flex-col items-center justify-center py-1.5 px-3 rounded-xl transition-all duration-200 ${
                active
                  ? 'text-teal-600 dark:text-teal-400 font-bold scale-105'
                  : 'text-fg-muted hover:text-fg font-medium'
              }`}
            >
              <div
                className={`p-1 rounded-lg transition-colors ${
                  active ? 'bg-teal-500/15 text-teal-600 dark:text-teal-300' : 'text-fg-muted'
                }`}
              >
                <Icon className="w-5 h-5" />
              </div>
              <span className="text-[10px] mt-0.5 tracking-tight">{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
};
