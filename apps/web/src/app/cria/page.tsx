import { apiSafe } from '@/lib/server-api';
import { EmptyState } from '@/components/ui';
import { BreedingView } from './BreedingView';
// El rango por defecto lo decide la API, que sabe en qué zona empieza el día de la finca; acá se
// lee el que efectivamente usó (viene en la respuesta). Calcularlo en el servidor web daba la fecha
// de ESA máquina —UTC en producción—, así que después de las 20:00 el período arrancaba un día
// adelantado.

/** Cría y recría (C3): panel de eficiencia del rodeo de cría (destete/entore, kg/ha, reposición). */
export default async function CriaPage() {
  const summary = await apiSafe<any>('/breeding/summary');
  if (summary === null) {
    return <EmptyState title="La API no está disponible" body="Iniciá el backend con `npm run api` y recargá." />;
  }
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Cría y recría</h1>
        <p className="mt-0.5 text-body text-ink-3">Eficiencia del rodeo de cría: destete por vientre, kilos destetados por hectárea y reposición.</p>
      </div>
      <BreedingView initial={summary} from={summary.from} to={summary.to} />
    </div>
  );
}
