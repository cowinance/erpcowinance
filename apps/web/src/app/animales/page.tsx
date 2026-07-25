import Link from 'next/link';
import { apiSafe } from '@/lib/server-api';
import { EmptyState } from '@/components/ui';
import { Plus, ShieldCheck, Upload } from 'lucide-react';
import { AnimalsBrowser } from './AnimalsBrowser';

export default async function AnimalsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string; status?: string; lot?: string }>;
}) {
  const params = await searchParams;

  // El navegador cliente (AnimalsBrowser) carga la lista con filtros + paginación; aquí
  // solo resolvemos los catálogos (categorías/lotes) para poblar los selectores.
  const [categories, lots] = await Promise.all([
    apiSafe<any[]>('/catalogs/categories'),
    apiSafe<any[]>('/lots'),
  ]);

  if (!categories) {
    return <EmptyState title="La API no está disponible" body="Iniciá el backend con `npm run api` y recargá." />;
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Animales</h1>
          <p className="mt-0.5 text-body text-ink-3">Vista 360 del hato — buscá, filtrá y abrí la ficha de cada animal</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/animales/calidad"
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-strong px-3 text-body font-medium text-ink-2 hover:bg-sunken"
          >
            <ShieldCheck size={15} /> Calidad
          </Link>
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

      <AnimalsBrowser
        categories={categories ?? []}
        lots={lots ?? []}
        initial={{ q: params.q, category: params.category, status: params.status, lot: params.lot }}
      />
    </div>
  );
}
