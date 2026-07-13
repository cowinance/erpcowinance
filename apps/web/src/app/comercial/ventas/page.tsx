import { apiSafe } from '@/lib/server-api';
import { EmptyState } from '@/components/ui';
import { CommerceNav } from '../CommerceNav';
import { DocumentForm } from '../DocumentForm';
import { DocumentList } from '../DocumentList';

/** Ventas (C-4): alta con líneas de ítem/animal + máquina de estados; entregar descuenta stock y
 *  marca el animal como vendido (C-3). */
export default async function SalesPage() {
  const [sales, partners, items, animals] = await Promise.all([
    apiSafe<any[]>('/commerce/sales'),
    apiSafe<any[]>('/commerce/partners?type=customer'),
    apiSafe<any[]>('/inventory/items'),
    apiSafe<any[]>('/animals?status=active'),
  ]);
  if (sales === null) {
    return <EmptyState title="La API no está disponible" body="Iniciá el backend con `npm run api` y recargá." />;
  }
  const docs = (sales ?? []).map((s) => ({ id: s.id, document_number: s.document_number, party_name: s.customer_name, total: s.total, currency: s.currency, status: s.status, date: s.sale_date }));
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Comercial</h1>
        <p className="mt-0.5 text-body text-ink-3">Ventas a clientes. Al entregar, se descuenta el stock y se marca el animal como vendido.</p>
      </div>
      <CommerceNav />
      <div className="grid grid-cols-3 gap-4 max-lg:grid-cols-1">
        <DocumentForm kind="sale" partners={partners ?? []} items={items ?? []} warehouses={[]} animals={animals ?? []} />
        <DocumentList kind="sale" docs={docs} />
      </div>
    </div>
  );
}
