import { apiSafe } from '@/lib/server-api';
import { EmptyState } from '@/components/ui';
import { GeneticsNav } from '../GeneticsNav';
import { TankManager } from './TankManager';

/**
 * Genética — termos (GT-1): la estructura física donde vive lo congelado.
 *
 * El termo seleccionado viaja por la URL y no por estado del cliente: así el enlace a «el 207» se
 * puede compartir y recargar, que es lo que se hace cuando alguien pregunta desde el corral dónde
 * está algo.
 */
export default async function TanksPage({ searchParams }: { searchParams: Promise<{ tank?: string }> }) {
  const { tank } = await searchParams;
  const tanks = await apiSafe<any[]>('/genetics/cryo/tanks');
  if (tanks === null) {
    return <EmptyState title="La API no está disponible" body="Iniciá el backend con `npm run api` y recargá." />;
  }
  const selected = tank ? await apiSafe<any>(`/genetics/cryo/tanks/${tank}`) : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Genética</h1>
        <p className="mt-0.5 text-body text-ink-3">
          Termos de nitrógeno: canastas y gobeletes. Es la ubicación que después va a decir dónde está cada pajuela.
        </p>
      </div>
      <GeneticsNav />
      <TankManager tanks={tanks ?? []} selected={selected} />
    </div>
  );
}
