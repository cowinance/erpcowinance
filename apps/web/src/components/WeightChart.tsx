/** Gráfico de línea SVG sin dependencias (doc diseño §10.5): 2 px, grid horizontal, área 8%. */
export function WeightChart({
  points,
  width = 560,
  height = 180,
  unit = 'kg',
}: {
  points: { label: string; value: number }[];
  width?: number;
  height?: number;
  unit?: string;
}) {
  if (!points.length) return <div className="py-10 text-center text-[13px] text-ink-3">Sin datos todavía</div>;

  const pad = { top: 12, right: 12, bottom: 24, left: 44 };
  const w = width - pad.left - pad.right;
  const h = height - pad.top - pad.bottom;
  const values = points.map((p) => p.value);
  const min = Math.min(...values) * 0.95;
  const max = Math.max(...values) * 1.05;
  const x = (i: number) => pad.left + (points.length === 1 ? w / 2 : (i / (points.length - 1)) * w);
  const y = (v: number) => pad.top + h - ((v - min) / (max - min || 1)) * h;

  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const area = `${path} L${x(points.length - 1).toFixed(1)},${pad.top + h} L${x(0).toFixed(1)},${pad.top + h} Z`;
  const gridLines = 4;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label="Evolución de peso">
      {Array.from({ length: gridLines + 1 }, (_, i) => {
        const v = min + ((max - min) / gridLines) * i;
        return (
          <g key={i}>
            <line
              x1={pad.left}
              x2={width - pad.right}
              y1={y(v)}
              y2={y(v)}
              stroke="var(--border-subtle)"
              strokeWidth="1"
            />
            <text x={pad.left - 8} y={y(v) + 3.5} textAnchor="end" fontSize="10" fill="var(--text-tertiary)">
              {Math.round(v)}
            </text>
          </g>
        );
      })}
      <path d={area} fill="var(--accent)" opacity="0.08" />
      <path d={path} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={x(i)} cy={y(p.value)} r="2.5" fill="var(--accent)" />
          {(points.length <= 8 || i % Math.ceil(points.length / 8) === 0) && (
            <text x={x(i)} y={height - 6} textAnchor="middle" fontSize="10" fill="var(--text-tertiary)">
              {p.label}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}
