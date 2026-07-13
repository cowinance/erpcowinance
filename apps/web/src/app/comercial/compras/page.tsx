import { apiSafe } from '@/lib/server-api';
import { EmptyState } from '@/components/ui';
import { CommerceNav } from '../CommerceNav';
import { DocumentForm } from '../DocumentForm';
import { DocumentList } from '../DocumentList';

/** Compras (C-4): alta con líneas + máquina de estados; recibir engancha al kardex (C-2). */
export default async function PurchasesPage() {
  const [purchases, partners, items, warehouses] = await Promise.all([
    apiSafe<any[]>('/commerce/purchases'),
    apiSafe<any[]>('/commerce/partners?type=supplier'),
    apiSafe<any[]>('/inventory/items'),
    apiSafe<any[]>('/inventory/warehouses'),
  ]);
  if (purchases === null) {
    return <EmptyState title="La API no está disponible" body="Iniciá el backend con `npm run api` y recargá." />;
  }
  const docs = (purchases ?? []).map((p) => ({ id: p.id, document_number: p.document_number, party_name: p.supplier_name, total: p.total, currency: p.currency, status: p.status, date: p.purchase_date }));
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Comercial</h1>
        <p className="mt-0.5 text-body text-ink-3">Compras a proveedores. Al recibir, las líneas de ítem entran al stock.</p>
      </div>
      <CommerceNav />
      <div className="grid grid-cols-3 gap-4 max-lg:grid-cols-1">
        <DocumentForm kind="purchase" partners={partners ?? []} items={items ?? []} warehouses={warehouses ?? []} animals={[]} />
        <DocumentList kind="purchase" docs={docs} />
      </div>
    </div>
  );
}
