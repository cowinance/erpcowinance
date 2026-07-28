import { apiSafe } from '@/lib/server-api';
import { EmptyState } from '@/components/ui';
import { GeneticsNav } from '../GeneticsNav';
import { DamEvaluation, type DamReport } from './DamEvaluation';

/**
 * Genética — evaluación de vientres.
 *
 * La otra mitad de la genética de cada ternero, que el módulo no miraba: hasta acá `dam_id` solo
 * entraba como ajuste del peso al destete de las crías, nunca como sujeto. Eso dejaba afuera la
 * decisión más frecuente de una finca de cría —qué vientres retener y cuáles descartar—, que se
 * tomaba a ojo.
 */
export default async function DamEvaluationPage() {
  const report = await apiSafe<DamReport>('/genetics/dam-evaluation');
  if (report === null) return <EmptyState title="La API no está disponible" body="Iniciá el backend con `npm run api` y recargá." />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Genética</h1>
        <p className="mt-0.5 text-body text-ink-3">Kilos destetados por vaca y por año: con qué vientres quedarse.</p>
      </div>
      <GeneticsNav />
      <DamEvaluation report={report} />
    </div>
  );
}
