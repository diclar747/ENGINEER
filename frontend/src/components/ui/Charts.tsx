import React from 'react';

/* Paleta consistente con el tema (teal/emerald + acentos). */
export const CH = {
  teal: '#14b8a6', emerald: '#10b981', amber: '#f59e0b', rose: '#f43f5e',
  slate: '#94a3b8', violet: '#8b5cf6', sky: '#0ea5e9', grid: 'currentColor',
};

const fmt = (n: number) => new Intl.NumberFormat('es-PY').format(Math.round(n));

/** Serie temporal: área + línea. `data` = [{label, value}]. */
export const AreaLine: React.FC<{ data: { label: string; value: number }[]; height?: number; color?: string }> = ({
  data, height = 120, color = CH.teal,
}) => {
  const W = 600;
  const H = height;
  const pad = 6;
  const max = Math.max(1, ...data.map((d) => d.value));
  const n = Math.max(1, data.length - 1);
  const x = (i: number) => pad + (i * (W - pad * 2)) / n;
  const y = (v: number) => H - pad - (v / max) * (H - pad * 2);
  const pts = data.map((d, i) => `${x(i)},${y(d.value)}`).join(' ');
  const area = `${pad},${H - pad} ${pts} ${W - pad},${H - pad}`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} className="text-fg-muted/20 overflow-visible">
      <polyline points={area} fill={color} fillOpacity={0.12} stroke="none" />
      <polyline points={pts} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
      {data.map((d, i) => (
        <circle key={i} cx={x(i)} cy={y(d.value)} r={i === data.length - 1 ? 3.5 : 0} fill={color} />
      ))}
    </svg>
  );
};

/** Barras verticales. `data` = [{label, value}]. */
export const Bars: React.FC<{ data: { label: string; value: number }[]; height?: number; color?: string }> = ({
  data, height = 120, color = CH.emerald,
}) => {
  const H = height;
  const max = Math.max(1, ...data.map((d) => d.value));
  const bw = 100 / Math.max(1, data.length);
  return (
    <svg viewBox={`0 0 100 ${H}`} width="100%" height={H} preserveAspectRatio="none">
      {data.map((d, i) => {
        const h = (d.value / max) * (H - 6);
        return <rect key={i} x={i * bw + bw * 0.15} y={H - h} width={bw * 0.7} height={Math.max(h, d.value > 0 ? 1.5 : 0)} rx={1} fill={color} />;
      })}
    </svg>
  );
};

/** Dona de proporciones. `data` = [{label, value, color}]. */
export const Donut: React.FC<{ data: { label: string; value: number; color: string }[]; size?: number }> = ({ data, size = 132 }) => {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const r = size / 2 - 10;
  const c = 2 * Math.PI * r;
  let acc = 0;
  return (
    <div className="flex items-center gap-4">
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} className="shrink-0">
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          {data.map((d, i) => {
            const frac = d.value / total;
            const dash = `${frac * c} ${c}`;
            const el = (
              <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={d.color} strokeWidth={14}
                strokeDasharray={dash} strokeDashoffset={-acc * c} />
            );
            acc += frac;
            return el;
          })}
        </g>
        <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central" className="fill-fg font-black" style={{ fontSize: 18 }}>
          {fmt(total)}
        </text>
      </svg>
      <ul className="text-xs space-y-1">
        {data.map((d) => (
          <li key={d.label} className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: d.color }} />
            <span className="text-fg-soft">{d.label}</span>
            <span className="text-fg-muted ml-auto font-semibold">{fmt(d.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};

/** Barras horizontales para categorías. `data` = [{label, value}]. */
export const HBars: React.FC<{ data: { label: string; value: number; sub?: string }[]; color?: string }> = ({ data, color = CH.teal }) => {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="space-y-2">
      {data.length === 0 && <p className="text-xs text-fg-muted">Sin datos en el rango.</p>}
      {data.map((d) => (
        <div key={d.label} className="text-xs">
          <div className="flex justify-between mb-0.5">
            <span className="text-fg-soft font-medium">{d.label}</span>
            <span className="text-fg-muted">{d.sub || fmt(d.value)}</span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${(d.value / max) * 100}%`, background: color }} />
          </div>
        </div>
      ))}
    </div>
  );
};
