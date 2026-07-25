import { apiSafe } from '@/lib/server-api';
import { EmptyState } from '@/components/ui';
import { CommerceNav } from '../CommerceNav';
import { CrmView } from './CrmView';

/** CRM (F3): pipeline comercial, seguimiento e historial de contratos sobre los socios. */
export default async function CrmPage() {
  const [summary, opportunities, partners, contracts, followUps, interactions] = await Promise.all([
    apiSafe<any>('/crm/summary'),
    apiSafe<any[]>('/crm/opportunities'),
    apiSafe<any[]>('/commerce/partners'),
    apiSafe<any[]>('/crm/contracts'),
    apiSafe<any[]>('/crm/follow-ups'),
    apiSafe<any[]>('/crm/interactions?limit=15'),
  ]);
  if (summary === null) {
    return <EmptyState title="La API no está disponible" body="Iniciá el backend con `npm run api` y recargá." />;
  }
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">CRM</h1>
        <p className="mt-0.5 text-body text-ink-3">
          Pipeline comercial, seguimiento de la relación y vigencia de contratos.
        </p>
      </div>
      <CommerceNav />
      <CrmView
        summary={summary}
        opportunities={opportunities ?? []}
        partners={partners ?? []}
        contracts={contracts ?? []}
        followUps={followUps ?? []}
        interactions={interactions ?? []}
      />
    </div>
  );
}
