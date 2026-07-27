import Link from 'next/link';
import { Input } from '@/components/Input';
import { Select } from '@/components/Select';

interface SelectFilter {
  name: string;
  label: string;
  value?: string;
  options: { value: string; label: string }[];
}

/**
 * Barra de filtros del panel: un `<form method="get">`, sin una línea de JavaScript.
 *
 * Es la forma correcta acá y no una simplificación. Al enviarse por GET, los filtros terminan en
 * la URL, que es de donde los lee el Server Component: el estado del panel ES la dirección. Eso da
 * gratis lo que con estado en cliente habría que construir a mano —enlaces compartibles, botón
 * «atrás», recarga sin perder la búsqueda— y evita traer el listado dos veces (una en el servidor
 * y otra al hidratar).
 *
 * `offset` NO se conserva: cambiar un filtro tiene que volver a la primera página, o el operador
 * filtra y ve «no hay resultados» porque quedó parado en la página 4 de un listado que ahora tiene
 * una.
 */
export function Filtros({
  action,
  buscar,
  selects = [],
  fechas = [],
  hidden = {},
}: {
  action: string;
  buscar?: { name: string; placeholder: string; value?: string };
  selects?: SelectFilter[];
  /** Rango de días (`YYYY-MM-DD`). El backend los aplica inclusive en los dos extremos. */
  fechas?: { name: string; label: string; value?: string }[];
  /**
   * Valores que el formulario tiene que CONSERVAR sin mostrar. Los usa la auditoría para no perder
   * la pestaña activa (`kind`) al filtrar: sin esto, filtrar por email te devolvía a «Acciones»
   * aunque estuvieras mirando «Accesos», y el filtro parecía haber hecho otra cosa.
   */
  hidden?: Record<string, string | undefined>;
}) {
  const hayFiltros = Boolean(buscar?.value) || selects.some((s) => s.value) || fechas.some((f) => f.value);
  // «Limpiar» conserva lo oculto: en la auditoría eso es la pestaña activa. Mandarte a otra vista al
  // limpiar los filtros haría parecer que el botón hizo algo más de lo que dice.
  const conservados = new URLSearchParams(Object.entries(hidden).filter(([, v]) => v) as [string, string][]).toString();
  const limpiarHref = conservados ? `${action}?${conservados}` : action;
  return (
    <form action={action} method="get" className="mb-4 flex flex-wrap items-end gap-2">
      {Object.entries(hidden).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      {buscar && (
        <div className="min-w-[240px] flex-1">
          <label htmlFor={buscar.name} className="mb-1 block text-label text-ink-2">
            Buscar
          </label>
          <Input id={buscar.name} name={buscar.name} defaultValue={buscar.value ?? ''} placeholder={buscar.placeholder} />
        </div>
      )}
      {selects.map((s) => (
        <div key={s.name} className="min-w-[150px]">
          <label htmlFor={s.name} className="mb-1 block text-label text-ink-2">
            {s.label}
          </label>
          <Select id={s.name} name={s.name} defaultValue={s.value ?? ''}>
            <option value="">Todos</option>
            {s.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
      ))}
      {fechas.map((f) => (
        <div key={f.name} className="min-w-[140px]">
          <label htmlFor={f.name} className="mb-1 block text-label text-ink-2">
            {f.label}
          </label>
          <Input id={f.name} name={f.name} type="date" defaultValue={f.value ?? ''} />
        </div>
      ))}
      <button type="submit" className="h-9 rounded-md bg-brand px-4 text-body font-medium text-white">
        Filtrar
      </button>
      {hayFiltros && (
        <Link href={limpiarHref} className="h-9 rounded-md border border-subtle px-3 text-body leading-9 text-ink-2 hover:bg-sunken">
          Limpiar
        </Link>
      )}
    </form>
  );
}
