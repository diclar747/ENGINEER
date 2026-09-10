import React from 'react';

/**
 * Primitivas de layout compartidas entre el panel admin y el dashboard del
 * titular — una sola base visual: tarjetas, encabezados de sección, barras de
 * herramientas, tablas con scroll seguro en móvil, estados vacíos y KPIs.
 */

/** Título de página (arriba de todo, con acciones opcionales a la derecha). */
export const PageTitle: React.FC<{
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  right?: React.ReactNode;
}> = ({ title, subtitle, icon, right }) => (
  <div className="flex flex-wrap items-start justify-between gap-3">
    <div className="flex items-center gap-2.5 min-w-0">
      {icon && <span className="text-teal-600 dark:text-teal-400 shrink-0">{icon}</span>}
      <div className="min-w-0">
        <h1 className="text-lg sm:text-xl font-black text-fg truncate">{title}</h1>
        {subtitle && <p className="text-xs text-fg-muted mt-0.5">{subtitle}</p>}
      </div>
    </div>
    {right && <div className="flex items-center gap-2 shrink-0">{right}</div>}
  </div>
);

/** Encabezado de una sección/tarjeta: ícono + título + slot a la derecha + línea. */
export const SectionHead: React.FC<{
  title: React.ReactNode;
  icon?: React.ReactNode;
  right?: React.ReactNode;
  className?: string;
}> = ({ title, icon, right, className = '' }) => (
  <div className={`flex flex-wrap items-center justify-between gap-2 border-b border-line/70 pb-2.5 mb-3 ${className}`}>
    <h3 className="text-[11px] sm:text-xs font-black uppercase tracking-wider text-fg-soft flex items-center gap-2 min-w-0">
      {icon && <span className="text-teal-600 dark:text-teal-400 shrink-0">{icon}</span>}
      <span className="truncate">{title}</span>
    </h3>
    {right && <div className="flex items-center gap-2 text-xs text-fg-muted shrink-0">{right}</div>}
  </div>
);

/** Tarjeta contenedora. `title` opcional dibuja un `SectionHead` automáticamente. */
export const Section: React.FC<{
  children: React.ReactNode;
  title?: React.ReactNode;
  icon?: React.ReactNode;
  right?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}> = ({ children, title, icon, right, className = '', bodyClassName = '' }) => (
  <section className={`bg-card border border-line rounded-2xl p-4 sm:p-5 shadow-sm ${className}`}>
    {title && <SectionHead title={title} icon={icon} right={right} />}
    <div className={bodyClassName}>{children}</div>
  </section>
);

/** Barra de filtros/acciones: se apila bien en móvil, los hijos hacen wrap. */
export const Toolbar: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <div className={`flex flex-wrap items-center gap-2 ${className}`}>{children}</div>
);

/**
 * Envuelve una `<table>` para que en pantallas chicas haga scroll horizontal
 * dentro de su caja (y NO empuje el ancho de toda la página). Encabezado fijo.
 */
export const TableWrap: React.FC<{ children: React.ReactNode; minWidth?: number; maxHeight?: number }> = ({
  children,
  minWidth = 640,
  maxHeight,
}) => (
  <div className="-mx-1 overflow-x-auto overscroll-x-contain rounded-xl border border-line/60" style={maxHeight ? { maxHeight, overflowY: 'auto' } : undefined}>
    <div style={{ minWidth }}>{children}</div>
  </div>
);

/** Estado vacío consistente. */
export const EmptyState: React.FC<{ icon?: React.ReactNode; title: string; hint?: React.ReactNode; className?: string }> = ({
  icon,
  title,
  hint,
  className = '',
}) => (
  <div className={`py-8 text-center ${className}`}>
    {icon && <div className="text-fg-muted/60 mb-2 flex justify-center">{icon}</div>}
    <p className="text-sm font-bold text-fg-soft">{title}</p>
    {hint && <p className="text-xs text-fg-muted mt-1">{hint}</p>}
  </div>
);

/** KPI / número grande con etiqueta. `tone` pinta el bloque de color sólido (estilo Winsap). */
const STAT_TONES: Record<string, string> = {
  amber: 'bg-gradient-to-br from-amber-400 to-orange-500 text-white border-transparent',
  indigo: 'bg-gradient-to-br from-indigo-500 to-indigo-700 text-white border-transparent',
  blue: 'bg-gradient-to-br from-sky-500 to-blue-600 text-white border-transparent',
  emerald: 'bg-gradient-to-br from-emerald-500 to-teal-600 text-white border-transparent',
  rose: 'bg-gradient-to-br from-rose-500 to-rose-600 text-white border-transparent',
};
export const Stat: React.FC<{
  label: React.ReactNode;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: React.ReactNode;
  danger?: boolean;
  tone?: 'amber' | 'indigo' | 'blue' | 'emerald' | 'rose';
}> = ({ label, value, hint, icon, danger, tone }) => {
  const solid = tone ? STAT_TONES[tone] : '';
  return (
    <div className={`rounded-2xl p-3.5 sm:p-4 border ${solid || 'bg-card border-line'}`}>
      <div className="flex items-center justify-between">
        <p className={`text-[10px] sm:text-[11px] font-bold uppercase tracking-wide ${solid ? 'text-white/80' : 'text-fg-muted'}`}>{label}</p>
        {icon && <span className={solid ? 'text-white/90' : danger ? 'text-rose-500' : 'text-teal-600 dark:text-teal-400'}>{icon}</span>}
      </div>
      <p className={`text-xl sm:text-2xl font-black mt-1 ${solid ? 'text-white' : danger ? 'text-rose-600 dark:text-rose-400' : 'text-fg'}`}>{value}</p>
      {hint && <p className={`text-[11px] mt-0.5 ${solid ? 'text-white/75' : 'text-fg-muted'}`}>{hint}</p>}
    </div>
  );
};

/** Botón pill con variantes (primario esmeralda con degradado, suave, fantasma). */
export const Btn: React.FC<
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'soft' | 'ghost' | 'danger'; icon?: React.ReactNode }
> = ({ variant = 'soft', icon, children, className = '', ...rest }) => {
  const v =
    variant === 'primary'
      ? 'bg-gradient-to-r from-teal-500 to-emerald-500 hover:from-teal-400 hover:to-emerald-400 text-white shadow-sm shadow-emerald-500/25'
      : variant === 'danger'
        ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400 hover:bg-rose-500/15 border border-rose-500/25'
        : variant === 'ghost'
          ? 'text-fg-soft hover:bg-muted'
          : 'bg-muted text-fg-soft hover:bg-muted/70 border border-line';
  return (
    <button {...rest} className={`inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition-all active:scale-95 disabled:opacity-50 ${v} ${className}`}>
      {icon}
      {children}
    </button>
  );
};

/**
 * Shell con barra lateral (estilo Winsap): sidebar degradado a la izquierda en
 * desktop, drawer en móvil, header con título + acciones. `nav` puede navegar
 * (href) o cambiar de vista (onClick).
 */
export type NavItem = { id: string; label: React.ReactNode; icon?: React.ReactNode; active?: boolean; onClick?: () => void; href?: string; badge?: React.ReactNode };
export const AppShell: React.FC<{
  brand: React.ReactNode;
  nav: NavItem[];
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  headerRight?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
}> = ({ brand, nav, title, subtitle, headerRight, footer, children }) => {
  const [open, setOpen] = React.useState(false);
  const NavList = (
    <nav className="flex-1 px-3 py-2 space-y-1 overflow-y-auto">
      {nav.map((n) => {
        const cls = `w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-bold transition-colors ${
          n.active ? 'bg-white/20 text-white' : 'text-white/75 hover:bg-white/10 hover:text-white'
        }`;
        const inner = (
          <>
            <span className="shrink-0 opacity-90">{n.icon}</span>
            <span className="truncate flex-1 text-left">{n.label}</span>
            {n.badge != null && <span className="text-[10px] font-black bg-white/25 rounded-full px-1.5 py-0.5">{n.badge}</span>}
          </>
        );
        return n.href ? (
          <a key={n.id} href={n.href} onClick={() => setOpen(false)} className={cls}>{inner}</a>
        ) : (
          <button key={n.id} type="button" onClick={() => { n.onClick?.(); setOpen(false); }} className={cls}>{inner}</button>
        );
      })}
    </nav>
  );
  const Aside = (
    <div className="h-full flex flex-col bg-gradient-to-b from-teal-600 via-emerald-600 to-emerald-500 text-white">
      <div className="px-4 py-4 flex items-center gap-2">{brand}</div>
      {NavList}
      {footer && <div className="px-3 py-3 border-t border-white/15">{footer}</div>}
    </div>
  );
  return (
    <div className="min-h-screen bg-app text-fg">
      {/* Sidebar desktop */}
      <aside className="hidden lg:block fixed inset-y-0 left-0 w-[248px] z-30">{Aside}</aside>
      {/* Drawer móvil */}
      {open && (
        <>
          <div className="lg:hidden fixed inset-0 bg-black/40 z-40" onClick={() => setOpen(false)} />
          <aside className="lg:hidden fixed inset-y-0 left-0 w-[248px] z-50 shadow-2xl animate-slide-up">{Aside}</aside>
        </>
      )}
      <div className="lg:pl-[248px]">
        <header className="sticky top-0 z-20 bg-app/85 backdrop-blur-md border-b border-line">
          <div className="px-3 sm:px-6 py-2.5 flex items-center gap-3">
            <button type="button" onClick={() => setOpen(true)} className="lg:hidden p-2 -ml-1 rounded-lg hover:bg-muted text-fg-soft">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
            </button>
            <div className="min-w-0 flex-1">
              {title && <h1 className="text-base sm:text-lg font-black text-fg truncate leading-tight">{title}</h1>}
              {subtitle && <p className="text-[11px] text-fg-muted truncate">{subtitle}</p>}
            </div>
            {headerRight && <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">{headerRight}</div>}
          </div>
        </header>
        <main className="p-3 sm:p-6 max-w-[1440px] mx-auto">{children}</main>
      </div>
    </div>
  );
};

/** Chip de KPI para el header (icono + etiqueta + número), estilo Winsap. */
export const HeaderStat: React.FC<{ icon?: React.ReactNode; label: React.ReactNode; value: React.ReactNode }> = ({ icon, label, value }) => (
  <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-xl bg-card border border-line">
    {icon && <span className="text-teal-600 dark:text-teal-400">{icon}</span>}
    <div className="leading-none">
      <div className="text-[9px] font-bold text-fg-muted uppercase tracking-wide">{label}</div>
      <div className="text-sm font-black text-fg">{value}</div>
    </div>
  </div>
);

/** Control segmentado (pestañas / toggle) horizontal, con scroll en móvil. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  size = 'md',
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ id: T; label: React.ReactNode; icon?: React.ReactNode }>;
  size?: 'sm' | 'md';
}) {
  const pad = size === 'sm' ? 'px-2.5 py-1 text-[11px]' : 'px-3.5 py-2 text-xs';
  return (
    <div className="flex gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          className={`flex items-center gap-1.5 rounded-xl font-bold shrink-0 transition-colors ${pad} ${
            value === o.id ? 'bg-teal-500 text-slate-950' : 'bg-muted/70 text-fg-soft hover:bg-muted'
          }`}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export const inputCls =
  'bg-card border border-line rounded-xl text-sm text-fg px-3 py-2 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 transition-shadow';
