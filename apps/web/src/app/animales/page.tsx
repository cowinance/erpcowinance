import Link from 'next/link';
import { apiSafe } from '@/lib/server-api';
import { EmptyState } from '@/components/ui';
import { STATUS_LABELS } from '@/lib/format';
import { Plus, Search, Upload } from 'lucide-react';
import { AnimalsTable } from './AnimalsTable';

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

  const [result, categories, lots] = await Promise.all([
    apiSafe<any>(`/animals?${qs}`),
    apiSafe<any[]>('/catalogs/categories'),
    apiSafe<any[]>('/lots'),
  ]);

  if (!result) {
    return <EmptyState title="La API no está disponible" body="Iniciá el backend con `npm run api` y recargá." />;
  }

  const animals = result.data ?? [];
  const chip = (href: string, label: string, active: boolean) => (
    <Link
      key={href}
      href={href}
      className={`inline-flex h-7 items-center rounded-full border px-3 text-label font-medium ${
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
          <p className="mt-0.5 text-body text-ink-3">
            {animals.length} animales{' '}
            {params.status === 'all' ? '' : `${STATUS_LABELS[params.status ?? 'active']?.toLowerCase() ?? 'activo'}${animals.length === 1 ? '' : 's'}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/animales/importar"
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-strong px-3 text-body font-medium text-ink-2 hover:bg-sunken"
          >
            <Upload size={15} /> Importar
          </Link>
          <Link
            href="/animales/nuevo"
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-brand px-4 text-body font-medium text-white hover:opacity-90"
          >
            <Plus size={15} /> Nuevo animal
          </Link>
        </div>
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
            className="h-8 w-64 rounded-md border border-strong bg-surface pl-8 text-body outline-none placeholder:text-ink-3 focus:ring-2 focus:ring-brand"
          />
        </form>
        {chip('/animales', 'Todas las categorías', !params.category)}
        {(categories ?? [])
          .filter((c) => c.animal_count > 0)
          .map((c) => chip(`/animales?category=${c.code}`, `${c.name}s (${c.animal_count})`, params.category === c.code))}
      </div>

      {/* Tabla maestra con selección múltiple (doc diseño §10.4) — cliente para la selección */}
      <AnimalsTable animals={animals} lots={lots ?? []} />
    </div>
  );
}
