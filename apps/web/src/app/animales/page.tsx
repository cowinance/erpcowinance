import Link from 'next/link';
import { apiSafe } from '@/lib/api';
import { EmptyState, StatusBadge } from '@/components/ui';
import { ageFrom, formatAdg, formatKg, relativeTime, STATUS_LABELS } from '@/lib/format';
import { Plus, Search } from 'lucide-react';

export default async function AnimalsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string; status?: string; lot?: string }>;
}) {
  const params = await searchParams;
  const qs = new URLSearchParams();
  if (params.q) qs.set('q', params.q);
  if (params.category) qs.set('category', params.category);
  if (params.lot) qs.set('lot', params.lot);
  qs.set('status', params.status ?? 'active');
  qs.set('limit', '100');

  const [result, categories] = await Promise.all([
    apiSafe<any>(`/animals?${qs}`),
    apiSafe<any[]>('/catalogs/categories'),
  ]);

  if (!result) {
    return <EmptyState title="La API no está disponible" body="Iniciá el backend con `npm run api` y recargá." />;
  }

  const animals = result.data ?? [];
  const chip = (href: string, label: string, active: boolean) => (
    <Link
      key={href}
      href={href}
      className={`inline-flex h-7 items-center rounded-full border px-3 text-[12px] font-medium ${
        active ? 'border-brand bg-brand-soft text-brand' : 'border-subtle bg-surface text-ink-2 hover:bg-sunken'
      }`}
    >
      {label}
    </Link>
  );

  return (
    <div>
      <div className="mb-5 flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold">Animales</h1>
          <p className="mt-0.5 text-[13px] text-ink-3">
            {animals.length} animales{' '}
            {params.status === 'all' ? '' : `${STATUS_LABELS[params.status ?? 'active']?.toLowerCase() ?? 'activo'}${animals.length === 1 ? '' : 's'}`}
          </p>
        </div>
        <Link
          href="/animales/nuevo"
          className="inline-flex h-9 items-center gap-1.5 rounded-md bg-brand px-4 text-[13px] font-medium text-white hover:opacity-90"
        >
          <Plus size={15} /> Nuevo animal
        </Link>
      </div>

      {/* Búsqueda + chips de filtro (doc diseño §12.1) */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <form className="relative" action="/animales">
          {params.category && <input type="hidden" name="category" value={params.category} />}
          <Search size={15} className="absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-3" />
          <input
            name="q"
            defaultValue={params.q ?? ''}
            placeholder="Caravana o nombre…"
            className="h-8 w-64 rounded-md border border-strong bg-surface pl-8 text-[13px] outline-none placeholder:text-ink-3 focus:ring-2 focus:ring-brand"
          />
        </form>
        {chip('/animales', 'Todas las categorías', !params.category)}
        {(categories ?? [])
          .filter((c) => c.animal_count > 0)
          .map((c) => chip(`/animales?category=${c.code}`, `${c.name}s (${c.animal_count})`, params.category === c.code))}
      </div>

      {/* Tabla maestra (doc diseño §10.4: filas 36 px, números tabulares) */}
      <div className="overflow-hidden rounded-[10px] border border-subtle bg-surface shadow-[var(--shadow-1)]">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="h-8 border-b border-subtle bg-sunken text-left text-[11px] font-medium tracking-[0.06em] text-ink-3 uppercase">
              <th className="pl-4">Caravana</th>
              <th>Nombre</th>
              <th>Categoría</th>
              <th>Raza</th>
              <th>Edad</th>
              <th>Lote</th>
              <th className="text-right">Último peso</th>
              <th className="pr-2 text-right">GDP</th>
              <th className="pr-4 text-right">Estado</th>
            </tr>
          </thead>
          <tbody>
            {animals.map((a: any) => (
              <tr key={a.id} className="h-9 border-b border-subtle last:border-0 hover:bg-sunken">
                <td className="pl-4">
                  <Link href={`/animales/${a.id}`} className="font-mono font-medium text-brand hover:underline">
                    {a.tag ?? '—'}
                  </Link>
                </td>
                <td className="text-ink-2">{a.name ?? '—'}</td>
                <td>{a.category ?? '—'}</td>
                <td className="text-ink-2">{a.breeds ?? '—'}</td>
                <td className="tnum text-ink-2">{ageFrom(a.birth_date)}</td>
                <td className="text-ink-2">{a.lot_name ?? '—'}</td>
                <td className="tnum text-right font-medium">
                  {formatKg(a.last_weight_kg)}
                  {a.last_weighed_at && (
                    <span className="ml-1.5 text-[11px] font-normal text-ink-3">{relativeTime(a.last_weighed_at)}</span>
                  )}
                </td>
                <td className="tnum pr-2 text-right text-ink-2">{a.adg != null ? a.adg.toFixed(2) : '—'}</td>
                <td className="pr-4 text-right">
                  <StatusBadge status={a.status} label={STATUS_LABELS[a.status] ?? a.status} />
                </td>
              </tr>
            ))}
            {!animals.length && (
              <tr>
                <td colSpan={9}>
                  <EmptyState
                    title="No hay animales con ese filtro"
                    body="Probá con otra búsqueda, o registrá tu primer animal para empezar a construir el historial del hato."
                    actionHref="/animales/nuevo"
                    actionLabel="Registrar animal"
                  />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
