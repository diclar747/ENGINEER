import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';

export type ThemePref = 'light' | 'dark' | 'system';
type Resolved = 'light' | 'dark';

const STORAGE_KEY = 'biopass_theme';

interface ThemeCtx {
  /** user preference */
  theme: ThemePref;
  /** what is actually applied right now */
  resolved: Resolved;
  setTheme: (t: ThemePref) => void;
  /** light ⇄ dark quick switch */
  toggle: () => void;
}

const Ctx = createContext<ThemeCtx | null>(null);

const readStored = (): ThemePref => {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {
    /* ignore */
  }
  return 'light'; // default: light
};

const systemDark = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;

const resolve = (pref: ThemePref): Resolved =>
  pref === 'system' ? (systemDark() ? 'dark' : 'light') : pref;

const apply = (r: Resolved) => {
  const el = document.documentElement;
  el.classList.toggle('dark', r === 'dark');
  const meta = document.querySelector('meta[name="theme-color"]:not([media])');
  if (meta) meta.setAttribute('content', r === 'dark' ? '#080e1a' : '#f7f9fc');
};

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setThemeState] = useState<ThemePref>(readStored);
  const [resolved, setResolved] = useState<Resolved>(() => resolve(readStored()));

  useEffect(() => {
    const r = resolve(theme);
    setResolved(r);
    apply(r);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  // Follow the OS when preference is "system"
  useEffect(() => {
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      const r = systemDark() ? 'dark' : 'light';
      setResolved(r);
      apply(r);
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [theme]);

  const setTheme = useCallback((t: ThemePref) => setThemeState(t), []);
  const toggle = useCallback(
    () => setThemeState((p) => (resolve(p) === 'dark' ? 'light' : 'dark')),
    [],
  );

  return <Ctx.Provider value={{ theme, resolved, setTheme, toggle }}>{children}</Ctx.Provider>;
};

export const useTheme = (): ThemeCtx => {
  const c = useContext(Ctx);
  if (!c) throw new Error('useTheme must be used within <ThemeProvider>');
  return c;
};
