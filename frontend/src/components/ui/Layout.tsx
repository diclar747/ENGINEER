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

/** KPI / número grande con etiqueta. */
export const Stat: React.FC<{
  label: React.ReactNode;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: React.ReactNode;
  danger?: boolean;
}> = ({ label, value, hint, icon, danger }) => (
  <div className="bg-card border border-line rounded-2xl p-3.5 sm:p-4">
    <div className="flex items-center justify-between">
      <p className="text-[10px] sm:text-[11px] font-bold text-fg-muted uppercase tracking-wide">{label}</p>
      {icon && <span className={danger ? 'text-rose-500' : 'text-teal-600 dark:text-teal-400'}>{icon}</span>}
    </div>
    <p className={`text-xl sm:text-2xl font-black mt-1 ${danger ? 'text-rose-600 dark:text-rose-400' : 'text-fg'}`}>{value}</p>
    {hint && <p className="text-[11px] text-fg-muted mt-0.5">{hint}</p>}
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
