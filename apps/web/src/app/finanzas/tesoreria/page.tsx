import { apiSafe } from '@/lib/server-api';
import { EmptyState } from '@/components/ui';
import { FinanceNav } from '../FinanceNav';
import { TreasuryView } from './TreasuryView';

// El rango por defecto lo decide la API, que sabe en qué zona empieza el día de la finca; acá se
// lee el que efectivamente usó (viene en la respuesta). Calcularlo en el servidor web daba la fecha
// de ESA máquina —UTC en producción—, así que después de las 20:00 el período arrancaba un día
// adelantado.

/** Finanzas — Tesorería (G3): liquidez por cuenta, flujo de caja, aging de CxC/CxP y días de cobro/pago. */
export default async function TreasuryPage() {
  const summary = await apiSafe<any>('/treasury/summary');
  if (summary === null) {
    return <EmptyState title="La API no está disponible" body="Iniciá el backend con `npm run api` y recargá." />;
  }
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Finanzas</h1>
        <p className="mt-0.5 text-body text-ink-3">Tesorería: liquidez, flujo de caja y antigüedad de saldos por cobrar y por pagar.</p>
      </div>
      <FinanceNav />
      <TreasuryView initial={summary} from={summary.from} to={summary.to} />
    </div>
  );
}
