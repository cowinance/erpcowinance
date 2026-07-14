import { apiSafe } from '@/lib/server-api';
import { EmptyState } from '@/components/ui';
import { GeneticsNav } from '../GeneticsNav';
import { EvaluationsManager } from './EvaluationsManager';

/** Genética — evaluaciones (G-3): scores genéticos por animal (traits jsonb). */
export default async function EvaluationsPage() {
  const [evaluations, animalsRes] = await Promise.all([apiSafe<any[]>('/genetics/evaluations'), apiSafe<{ data: any[] }>('/animals?status=active')]);
  if (evaluations === null) {
    return <EmptyState title="La API no está disponible" body="Iniciá el backend con `npm run api` y recargá." />;
  }
  const animals = animalsRes?.data ?? [];
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Genética</h1>
        <p className="mt-0.5 text-body text-ink-3">Evaluaciones genéticas por animal (EPDs/índices como pares clave/valor).</p>
      </div>
      <GeneticsNav />
      <EvaluationsManager evaluations={evaluations ?? []} animals={animals} />
    </div>
  );
}
