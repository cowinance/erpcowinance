import { apiSafe } from '@/lib/server-api';
import { EmptyState } from '@/components/ui';
import { ConfigView } from './ConfigView';

/** Configuración (A3): catálogos maestros. Lectura de globales + extensión por tenant de razas y diagnósticos. */
export default async function ConfiguracionPage() {
  const catalogs = await apiSafe<any>('/config/catalogs');
  if (catalogs === null) {
    return <EmptyState title="La API no está disponible" body="Iniciá el backend con `npm run api` y recargá." />;
  }
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Configuración</h1>
        <p className="mt-0.5 text-body text-ink-3">Catálogos maestros. Podés extender razas y diagnósticos con entradas propias de tu finca.</p>
      </div>
      <ConfigView catalogs={catalogs} />
    </div>
  );
}
