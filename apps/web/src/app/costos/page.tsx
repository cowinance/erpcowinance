import { apiSafe } from '@/lib/server-api';
import { EmptyState } from '@/components/ui';
import { CostingView } from './CostingView';

/**
 * Costos y rentabilidad (G2 · E5). Junta las cuatro vistas del módulo en una sola pantalla:
 * rentabilidad por actividad (el resumen), costo unitario, costos por centro y desvíos vs
 * presupuesto. Se carga en el servidor con el rango por defecto (último año); los cambios de rango,
 * nivel y presupuesto los resuelve el cliente contra la API.
 */
export default async function CostsPage() {
  const [profit, unit, budgets] = await Promise.all([
    apiSafe<any>('/costs/profitability?level=activity'),
    apiSafe<any>('/costs/unit'),
    apiSafe<any[]>('/finance/budgets'),
  ]);

  if (profit === null || unit === null) {
    return <EmptyState title="La API no está disponible" body="Iniciá el backend con `npm run api` y recargá." />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Costos y rentabilidad</h1>
        <p className="mt-0.5 text-body text-ink-3">
          Qué costó cada actividad, cuánto salió el kilo o el litro, y qué margen dejó cada lote.
        </p>
      </div>
      <CostingView initialProfit={profit} initialUnit={unit} budgets={budgets ?? []} />
    </div>
  );
}
