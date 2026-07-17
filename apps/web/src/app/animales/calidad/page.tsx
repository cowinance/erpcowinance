import Link from 'next/link';
import { apiSafe } from '@/lib/server-api';
import { Card, EmptyState } from '@/components/ui';
import { ArrowLeft } from 'lucide-react';
import { QualityIssues } from './QualityIssues';

/**
 * Calidad de datos del hato (A360 E6): banderas de completitud y coherencia agregadas por tipo,
 * con drill-down a las fichas y enlaces al listado filtrado (reusa los filtros de E1). Fuente única:
 * GET /animals/quality (regla SQL en herd.qualityReport). No duplica alertas repro/sanidad.
 */
export default async function QualityPage() {
  const report = await apiSafe<any>('/animals/quality');
  if (!report) {
    return <EmptyState title="La API no está disponible" body="Iniciá el backend con `npm run api` y recargá." />;
  }

  const withIssues = (report.issues ?? []).filter((i: any) => i.count > 0);
  const clean = withIssues.length === 0;

  return (
    <div>
      <Link href="/animales" className="mb-4 inline-flex items-center gap-1.5 text-body text-ink-2 hover:text-ink">
        <ArrowLeft size={14} /> Animales
      </Link>
      <div className="mb-5">
        <h1 className="text-xl font-semibold">Calidad de datos</h1>
        <p className="mt-0.5 text-body text-ink-3">
          {report.total} animales activos · {withIssues.length} tipo{withIssues.length === 1 ? '' : 's'} de problema detectado{withIssues.length === 1 ? '' : 's'}
        </p>
      </div>

      {clean ? (
        <Card>
          <p className="py-6 text-center text-body text-ink-2">Sin problemas de datos. El hato está completo y coherente. 🎉</p>
        </Card>
      ) : (
        <QualityIssues issues={withIssues} />
      )}
    </div>
  );
}
