import { apiSafe } from '@/lib/server-api';
import { EmptyState } from '@/components/ui';
import { SubscriptionView } from './SubscriptionView';

/**
 * Plan y suscripción (B-1): estado del plan del tenant, límites vs uso y cambio administrativo de
 * plan (owner/admin). NO procesa cobros — el pago real es del proveedor (fuera de alcance).
 */
export default async function SubscriptionPage() {
  const [subscription, plans] = await Promise.all([apiSafe<any>('/billing/subscription'), apiSafe<any[]>('/billing/plans')]);
  if (!subscription) {
    return <EmptyState title="La API no está disponible" body="Iniciá el backend con `npm run api` y recargá." />;
  }
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold">Plan y suscripción</h1>
        <p className="mt-0.5 text-body text-ink-3">Tu plan, sus límites y el uso actual. El cambio de plan no procesa cobros.</p>
      </div>
      <SubscriptionView subscription={subscription} plans={plans ?? []} />
    </div>
  );
}
