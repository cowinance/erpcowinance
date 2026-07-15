import { apiSafe } from '@/lib/server-api';
import { EmptyState } from '@/components/ui';
import { TamboView } from './TamboView';

/** Tambo (TB-3): producción diaria por vaca + total del tambo, entregas y calidad. */
export default async function TamboPage() {
  const [byDay, tanks, deliveries, quality, animalsRes] = await Promise.all([
    apiSafe<any[]>('/dairy/production/by-day'),
    apiSafe<any[]>('/dairy/tanks'),
    apiSafe<any[]>('/dairy/deliveries'),
    apiSafe<any[]>('/dairy/quality-tests'),
    apiSafe<{ data: any[] }>('/animals?status=active'),
  ]);
  if (byDay === null) {
    return <EmptyState title="La API no está disponible" body="Iniciá el backend con `npm run api` y recargá." />;
  }
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Tambo</h1>
        <p className="mt-0.5 text-body text-ink-3">Producción diaria por vaca, entregas al comprador y calidad de leche.</p>
      </div>
      <TamboView byDay={byDay ?? []} tanks={tanks ?? []} deliveries={deliveries ?? []} quality={quality ?? []} animals={animalsRes?.data ?? []} />
    </div>
  );
}
