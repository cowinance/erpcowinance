import { apiSafe } from '@/lib/server-api';
import { EmptyState } from '@/components/ui';
import { CommerceNav } from '../CommerceNav';
import { DocumentForm } from '../DocumentForm';
import { DocumentList } from '../DocumentList';

/** Ventas (C-4): alta con líneas de ítem/animal + máquina de estados; entregar descuenta stock y
 *  marca el animal como vendido (C-3). */
export default async function SalesPage() {
  const [sales, partners, items, animalsRes] = await Promise.all([
    apiSafe<any[]>('/commerce/sales'),
    apiSafe<any[]>('/commerce/partners?type=customer'),
    apiSafe<any[]>('/inventory/items'),
    apiSafe<{ data: any[] }>('/animals?status=active'),
  ]);
  if (sales === null) {
    return <EmptyState title="La API no está disponible" body="Iniciá el backend con `npm run api` y recargá." />;
  }
  const docs = (sales ?? []).map((s) => ({ id: s.id, document_number: s.document_number, party_name: s.customer_name, total: s.total, currency: s.currency, status: s.status, date: s.sale_date }));

  // El chequeo de certificaciones (Fase 3.3) se pide solo para las ventas que TODAVÍA SE PUEDEN
  // cambiar: el aviso existe para leerse antes de cerrar, y avisar sobre una venta ya cobrada solo
  // agrega ruido. El tope evita una ráfaga de pedidos en una lista larga; lo que queda afuera se
  // dice, en vez de mostrarse como si estuviera todo revisado.
  const ABIERTAS = ['draft', 'confirmed'];
  const revisables = docs.filter((d) => ABIERTAS.includes(d.status));
  const TOPE = 20;
  const checks = await Promise.all(revisables.slice(0, TOPE).map((d) => apiSafe<any>(`/commerce/sales/${d.id}/certifications`)));
  const certifications = Object.fromEntries(revisables.slice(0, TOPE).map((d, i) => [d.id, checks[i]]).filter(([, c]) => c != null));
  const sinRevisar = Math.max(0, revisables.length - TOPE);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Comercial</h1>
        <p className="mt-0.5 text-body text-ink-3">Ventas a clientes. Al entregar, se descuenta el stock y se marca el animal como vendido.</p>
      </div>
      <CommerceNav />
      <div className="grid grid-cols-3 gap-4 max-lg:grid-cols-1">
        <DocumentForm kind="sale" partners={partners ?? []} items={items ?? []} warehouses={[]} animals={animalsRes?.data ?? []} />
        <DocumentList kind="sale" docs={docs} certifications={certifications} uncheckedCount={sinRevisar} />
      </div>
    </div>
  );
}
