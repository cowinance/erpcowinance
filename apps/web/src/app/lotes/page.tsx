import Link from 'next/link';
import { apiSafe } from '@/lib/server-api';
import { EmptyState } from '@/components/ui';

const PURPOSE: Record<string, string> = {
  breeding: 'Cría',
  fattening: 'Engorde',
  dairy: 'Lechería',
  weaning: 'Recría / destete',
  quarantine: 'Cuarentena',
  hospital: 'Hospital',
};

export default async function LotsPage() {
  const lots = await apiSafe<any[]>('/lots');
  if (!lots) return <EmptyState title="La API no está disponible" body="Iniciá el backend con `npm run api` y recargá." />;

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold">Lotes</h1>
      <p className="mb-5 text-[13px] text-ink-3">Rodeos y grupos de manejo de la finca</p>
      <div className="grid grid-cols-3 gap-4 max-lg:grid-cols-2 max-md:grid-cols-1">
        {lots.map((l) => (
          <Link
            key={l.id}
            href={`/animales?lot=${l.id}`}
            className="rounded-[10px] border border-subtle bg-surface p-5 shadow-[var(--shadow-1)] transition-colors hover:border-strong"
          >
            <div className="text-[15px] font-semibold">{l.name}</div>
            <div className="mt-0.5 text-[12px] text-ink-3">
              {PURPOSE[l.purpose] ?? l.purpose ?? '—'} · {l.paddock_name ?? 'sin potrero'}
            </div>
            <div className="tnum mt-3 text-[26px] font-semibold">
              {l.animal_count}
              <span className="ml-1 text-[13px] font-normal text-ink-2">animales</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
