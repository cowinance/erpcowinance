import Link from 'next/link';

export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-[10px] border border-subtle bg-surface p-5 shadow-[var(--shadow-1)] ${className}`}>
      {children}
    </div>
  );
}

/**
 * Encabezado de tarjeta: título + acciones opcionales (filtros, totales, botones).
 *
 * `flex-wrap` no es decorativo: en un teléfono el título y dos selectores no entran en 375 px, y sin
 * envolver la fila empujaba la PÁGINA ENTERA a scrollear en horizontal — con lo que las acciones
 * quedaban fuera de pantalla y sin forma de llegar a ellas. Al envolver, bajan a la línea siguiente
 * y todo queda alcanzable.
 */
export function CardTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-subheading font-semibold">{children}</h2>
      {action}
    </div>
  );
}

export function KpiCard({
  label,
  value,
  unit,
  hint,
  tone,
}: {
  label: string;
  value: string | number;
  unit?: string;
  hint?: string;
  tone?: 'success' | 'warning' | 'danger';
}) {
  return (
    <Card>
      <div className="text-label text-ink-2">{label}</div>
      <div className="tnum mt-1 text-display leading-9 font-semibold">
        {value}
        {unit && <span className="ml-1 text-body font-normal text-ink-2">{unit}</span>}
      </div>
      {hint && (
        <div
          className={`mt-1 text-label ${
            tone === 'success' ? 'text-success' : tone === 'warning' ? 'text-warning' : tone === 'danger' ? 'text-danger' : 'text-ink-3'
          }`}
        >
          {hint}
        </div>
      )}
    </Card>
  );
}

const STATUS_STYLE: Record<string, string> = {
  active: 'bg-sunken text-ink-2 border-subtle',
  sold: 'bg-info/10 text-info border-info/30',
  dead: 'bg-sunken text-ink-3 border-subtle line-through',
  culled: 'bg-sunken text-ink-3 border-subtle',
  treatment: 'bg-warning/10 text-warning border-warning/30',
};

export function StatusBadge({ status, label }: { status: string; label: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-caption font-medium ${STATUS_STYLE[status] ?? STATUS_STYLE.active}`}
    >
      {label}
    </span>
  );
}

export function TagMono({ children }: { children: React.ReactNode }) {
  return <span className="font-mono text-body font-medium tracking-wide">{children}</span>;
}

export function EmptyState({
  title,
  body,
  actionHref,
  actionLabel,
}: {
  title: string;
  body: string;
  actionHref?: string;
  actionLabel?: string;
}) {
  return (
    <div className="py-14 text-center">
      <div className="text-subheading font-medium">{title}</div>
      <p className="mx-auto mt-1 max-w-sm text-body text-ink-3">{body}</p>
      {actionHref && actionLabel && (
        <Link
          href={actionHref}
          className="mt-4 inline-flex h-9 items-center rounded-md bg-brand px-4 text-body font-medium text-white"
        >
          {actionLabel}
        </Link>
      )}
    </div>
  );
}
