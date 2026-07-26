import { apiSafe } from '@/lib/server-api';
import { EmptyState } from '@/components/ui';
import { GeneticsNav } from '../GeneticsNav';
import { SirePerformance } from './SirePerformance';

/**
 * Genética — desempeño y costo por toro (Fase 2.3 a 2.5).
 *
 * Es la pantalla que convierte a Genética de depósito en herramienta: hasta acá el módulo sabía qué
 * pajuela había y en qué termo, y no contestaba la pregunta que cuesta plata — **¿qué semen vuelvo
 * a comprar?**
 *
 * Muestra las dos respuestas juntas a propósito, porque no coinciden: el índice dice cuál RINDE más
 * y el costo por kilo destetado dice cuál CONVIENE. Un toro puede ganar la primera columna y perder
 * la segunda, y ésa es exactamente la decisión que el productor tiene que tomar mirando las dos.
 */
export default async function SirePerformancePage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const { year } = await searchParams;
  const qs = year ? `?year=${encodeURIComponent(year)}` : '';
  const [cost, carcass] = await Promise.all([apiSafe<any>(`/genetics/sire-cost${qs}`), apiSafe<any>('/genetics/carcass-by-sire')]);

  if (cost === null) {
    return <EmptyState title="La API no está disponible" body="Iniciá el backend con `npm run api` y recargá." />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Genética</h1>
        <p className="mt-0.5 text-body text-ink-3">Desempeño de la progenie y costo del semen por kilo destetado.</p>
      </div>
      <GeneticsNav />
      <SirePerformance cost={cost} carcass={carcass} />
    </div>
  );
}
