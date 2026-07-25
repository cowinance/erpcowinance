import { apiSafe } from '@/lib/server-api';
import { EmptyState } from '@/components/ui';
import { CommerceNav } from './CommerceNav';
import { PartnersManager } from './PartnersManager';

/**
 * Comercial — maestro de socios (C-1): clientes/proveedores (business_partners) con sus satélites.
 * Server Component para la carga; las altas/bajas viven en PartnersManager. Sin compras/ventas (C-2/C-3).
 */
export default async function CommercialPage() {
  // El país decide cómo se llama y se valida la identificación fiscal (RIF en Venezuela, CUIT en
  // Argentina…). Se pide acá y no en el cliente para que el formulario ya nazca con la etiqueta
  // correcta, sin un parpadeo de «CUIT» en una finca venezolana.
  const [partners, org] = await Promise.all([apiSafe<any[]>('/commerce/partners'), apiSafe<any>('/organizations/current')]);
  if (partners === null) {
    return <EmptyState title="La API no está disponible" body="Iniciá el backend con `npm run api` y recargá." />;
  }
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold">Comercial</h1>
        <p className="mt-0.5 text-body text-ink-3">Maestro de socios: clientes, proveedores y contactos.</p>
      </div>
      <CommerceNav />
      <PartnersManager partners={partners ?? []} countryCode={org?.country_code ?? null} />
    </div>
  );
}
