import { apiSafe } from '@/lib/server-api';
import { EmptyState } from '@/components/ui';
import { PartnersManager } from './PartnersManager';

/**
 * Comercial — maestro de socios (C-1): clientes/proveedores (business_partners) con sus satélites.
 * Server Component para la carga; las altas/bajas viven en PartnersManager. Sin compras/ventas (C-2/C-3).
 */
export default async function CommercialPage() {
  const partners = await apiSafe<any[]>('/commerce/partners');
  if (partners === null) {
    return <EmptyState title="La API no está disponible" body="Iniciá el backend con `npm run api` y recargá." />;
  }
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold">Comercial</h1>
        <p className="mt-0.5 text-body text-ink-3">Maestro de socios: clientes, proveedores y contactos. Compras y ventas próximamente.</p>
      </div>
      <PartnersManager partners={partners ?? []} />
    </div>
  );
}
