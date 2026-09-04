import React from 'react';
import { Sun, Moon } from 'lucide-react';
import { useTheme } from '../theme';

/** Compact light ⇄ dark switch. */
export const ThemeToggle: React.FC<{ className?: string }> = ({ className = '' }) => {
  const { resolved, toggle } = useTheme();
  const dark = resolved === 'dark';
  return (
    <button
      onClick={toggle}
      aria-label={dark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
      title={dark ? 'Modo claro' : 'Modo oscuro'}
      className={`p-2 rounded-xl border border-line bg-muted/60 text-fg-soft hover:text-fg hover:border-teal-500/40 transition-colors ${className}`}
    >
      {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </button>
  );
};
