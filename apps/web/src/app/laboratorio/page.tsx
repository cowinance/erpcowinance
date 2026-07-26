import { apiSafe } from '@/lib/server-api';
import { EmptyState } from '@/components/ui';
import { LabNav } from './LabNav';
import { SamplesManager } from './SamplesManager';

/** Laboratorio (LAB-1/LAB-2): muestras con máquina de estados + resultados. */
export default async function LabPage() {
  const [samples, labs, animalsRes, paddocks, catalogs] = await Promise.all([
    apiSafe<any[]>('/lab/samples'),
    apiSafe<any[]>('/lab/labs'),
    apiSafe<{ data: any[] }>('/animals?status=active'),
    apiSafe<any[]>('/paddocks'),
    // Los diagnósticos son lo que convierte un resultado en un caso clínico (Fase 3.1).
    apiSafe<{ diagnoses: any[] }>('/config/catalogs'),
  ]);
  if (samples === null) {
    return <EmptyState title="La API no está disponible" body="Iniciá el backend con `npm run api` y recargá." />;
  }
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Laboratorio</h1>
        <p className="mt-0.5 text-body text-ink-3">Muestras y resultados. Una muestra se envía, se procesa y se completa.</p>
      </div>
      <LabNav />
      <SamplesManager samples={samples ?? []} labs={labs ?? []} animals={animalsRes?.data ?? []} paddocks={paddocks ?? []} diagnoses={catalogs?.diagnoses ?? []} />
    </div>
  );
}
