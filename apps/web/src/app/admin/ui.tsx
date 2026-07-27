import Link from 'next/link';

/**
 * Piezas del panel de plataforma. Viven acá y no en `components/ui.tsx` porque son de OTRA
 * aplicación: las del ERP están pensadas para pantallas de campo (densidad cómoda, tarjetas
 * grandes, se usan con guantes) y éstas para una tabla densa que se lee sentado. Compartirlas
 * obligaría a que cada cambio en una contemplara el otro caso de uso.
 */

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        {subtitle && <p className="mt-0.5 text-body text-ink-3">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: string | number; hint?: string; tone?: 'success' | 'warning' | 'danger' }) {
  const toneClass =
    tone === 'success' ? 'text-success' : tone === 'warning' ? 'text-warning' : tone === 'danger' ? 'text-danger' : 'text-ink-3';
  return (
    <div className="rounded-[10px] border border-subtle bg-surface p-4 shadow-[var(--shadow-1)]">
      <div className="text-label text-ink-2">{label}</div>
      <div className="tnum mt-1 text-[26px] leading-8 font-semibold">{value}</div>
      {hint && <div className={`mt-0.5 text-caption ${toneClass}`}>{hint}</div>}
    </div>
  );
}

export function Panel({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-[10px] border border-subtle bg-surface shadow-[var(--shadow-1)]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-subtle px-4 py-3">
        <h2 className="text-subheading font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/**
 * Contenedor de tabla con scroll HORIZONTAL PROPIO.
 *
 * El `overflow-x-auto` no es opcional en un panel con doce columnas: sin él la tabla ensancha la
 * página entera y la barra de navegación de arriba se va fuera de pantalla — o sea, el operador
 * pierde el menú por mirar una tabla ancha.
 *
 * `ancho` existe porque el mismo componente se usa en dos sitios muy distintos. En un listado a
 * pantalla completa, un mínimo de 720 px es lo que impide que diez columnas se aplasten hasta ser
 * ilegibles. Pero en las tarjetas de tres columnas del resumen ese mismo mínimo dejaba dos de las
 * tres columnas FUERA del panel, detrás de un scroll que no se ve: la tabla parecía tener una sola
 * columna. Ahí el mínimo correcto es ninguno.
 */
export function TableWrap({ children, ancho = 'ancho' }: { children: React.ReactNode; ancho?: 'ancho' | 'angosto' }) {
  return (
    <div className="overflow-x-auto">
      <table className={`w-full text-body ${ancho === 'ancho' ? 'min-w-[720px]' : ''}`}>{children}</table>
    </div>
  );
}

export function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th
      scope="col"
      className={`whitespace-nowrap border-b border-subtle px-4 py-2 text-label font-medium text-ink-2 ${align === 'right' ? 'text-right' : 'text-left'}`}
    >
      {children}
    </th>
  );
}

export function Td({ children, align = 'left', className = '' }: { children: React.ReactNode; align?: 'left' | 'right'; className?: string }) {
  return (
    <td className={`border-b border-subtle px-4 py-2 ${align === 'right' ? 'text-right tnum' : ''} ${className}`}>
      {children}
    </td>
  );
}

const PILL: Record<string, string> = {
  active: 'bg-success/10 text-success border-success/30',
  trialing: 'bg-info/10 text-info border-info/30',
  suspended: 'bg-warning/10 text-warning border-warning/30',
  past_due: 'bg-warning/10 text-warning border-warning/30',
  churned: 'bg-danger/10 text-danger border-danger/30',
  canceled: 'bg-danger/10 text-danger border-danger/30',
  blocked: 'bg-danger/10 text-danger border-danger/30',
  deleted: 'bg-sunken text-ink-3 border-subtle line-through',
};

const ETIQUETA: Record<string, string> = {
  active: 'Activa',
  suspended: 'Suspendida',
  churned: 'Baja',
  trialing: 'Prueba',
  past_due: 'Impaga',
  canceled: 'Cancelada',
  blocked: 'Bloqueado',
  deleted: 'Eliminado',
};

export function Pill({ value, label }: { value?: string | null; label?: string }) {
  if (!value) return <span className="text-ink-3">—</span>;
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-caption font-medium ${PILL[value] ?? 'bg-sunken text-ink-2 border-subtle'}`}
    >
      {label ?? ETIQUETA[value] ?? value}
    </span>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="px-4 py-10 text-center text-body text-ink-3">{children}</div>;
}

/**
 * Paginación por enlaces, no por botones con estado.
 *
 * Todo el panel se renderiza en el servidor y los filtros viajan en la URL, así que la página
 * siguiente es literalmente otra URL. Ventaja concreta: el estado que ve el operador es
 * compartible («mirá esta búsqueda») y el botón «atrás» del navegador funciona.
 */
export function Pager({ base, total, limit, offset }: { base: string; total: number; limit: number; offset: number }) {
  if (total <= limit) return null;
  const sep = base.includes('?') ? '&' : '?';
  const desde = offset + 1;
  const hasta = Math.min(offset + limit, total);
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 text-label text-ink-2">
      <span className="tnum">
        {desde}–{hasta} de {total}
      </span>
      <div className="flex gap-2">
        {offset > 0 && (
          <Link href={`${base}${sep}offset=${Math.max(offset - limit, 0)}`} className="rounded-md border border-subtle px-2.5 py-1 hover:bg-sunken">
            Anterior
          </Link>
        )}
        {hasta < total && (
          <Link href={`${base}${sep}offset=${offset + limit}`} className="rounded-md border border-subtle px-2.5 py-1 hover:bg-sunken">
            Siguiente
          </Link>
        )}
      </div>
    </div>
  );
}
