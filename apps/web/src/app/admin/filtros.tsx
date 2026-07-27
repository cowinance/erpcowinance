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
}: {
  action: string;
  buscar?: { name: string; placeholder: string; value?: string };
  selects?: SelectFilter[];
}) {
  const hayFiltros = Boolean(buscar?.value) || selects.some((s) => s.value);
  return (
    <form action={action} method="get" className="mb-4 flex flex-wrap items-end gap-2">
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
      <button type="submit" className="h-9 rounded-md bg-brand px-4 text-body font-medium text-white">
        Filtrar
      </button>
      {hayFiltros && (
        <Link href={action} className="h-9 rounded-md border border-subtle px-3 text-body leading-9 text-ink-2 hover:bg-sunken">
          Limpiar
        </Link>
      )}
    </form>
  );
}
