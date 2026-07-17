import { apiSafe } from '@/lib/server-api';
import { EmptyState } from '@/components/ui';
import { LabNav } from '../LabNav';
import { LabsManager } from './LabsManager';

/** Laboratorio (LAB-1): maestro de laboratorios. */
export default async function LabsPage() {
  const labs = await apiSafe<any[]>('/lab/labs');
  if (labs === null) {
    return <EmptyState title="La API no está disponible" body="Iniciá el backend con `npm run api` y recargá." />;
  }
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Laboratorio</h1>
        <p className="mt-0.5 text-body text-ink-3">Laboratorios a los que enviás muestras.</p>
      </div>
      <LabNav />
      <LabsManager labs={labs ?? []} />
    </div>
  );
}
