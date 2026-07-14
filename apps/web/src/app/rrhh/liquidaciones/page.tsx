import { apiSafe } from '@/lib/server-api';
import { EmptyState } from '@/components/ui';
import { RrhhNav } from '../RrhhNav';
import { PayrollView } from './PayrollView';

/** RRHH — liquidaciones (H-3): crear liquidación + aprobar/pagar (postea al mayor). */
export default async function PayrollPage() {
  const [payroll, employees] = await Promise.all([apiSafe<any[]>('/hr/payroll'), apiSafe<any[]>('/hr/employees?active=true')]);
  if (payroll === null) {
    return <EmptyState title="La API no está disponible" body="Iniciá el backend con `npm run api` y recargá." />;
  }
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Personal</h1>
        <p className="mt-0.5 text-body text-ink-3">Liquidaciones de sueldos. Aprobar postea el devengado; pagar postea la caja.</p>
      </div>
      <RrhhNav />
      <PayrollView payroll={payroll ?? []} employees={employees ?? []} />
    </div>
  );
}
