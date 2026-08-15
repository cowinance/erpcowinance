import Link from 'next/link';
import { Users } from 'lucide-react';
import { apiSafe } from '@/lib/server-api';
import { EmptyState } from '@/components/ui';
import { ConfigView } from './ConfigView';

/** Configuración (A3): catálogos maestros. Lectura de globales + extensión por tenant de razas y diagnósticos. */
export default async function ConfiguracionPage() {
  const [catalogs, currency, params, flags, rules] = await Promise.all([
    apiSafe<any>('/config/catalogs'),
    apiSafe<any>('/config/currency'),
    apiSafe<any>('/config/params'),
    apiSafe<any[]>('/config/feature-flags'),
    apiSafe<any[]>('/alerts/rules'),
  ]);
  if (catalogs === null) {
    return <EmptyState title="La API no está disponible" body="Iniciá el backend con `npm run api` y recargá." />;
  }
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Configuración</h1>
        <p className="mt-0.5 text-body text-ink-3">Moneda de la finca y catálogos maestros. Podés extender razas y diagnósticos con entradas propias.</p>
      </div>
      {/*
        Usuarios va como tarjeta y no como una pestaña más de ConfigView: las pestañas son
        catálogos —listas de cosas— y esto es gente con acceso. Además su permiso es distinto del
        resto de configuración, así que un capataz vería una pestaña que le devuelve 403.
      */}
      <Link
        href="/configuracion/usuarios"
        className="flex items-center gap-3 rounded-[10px] border border-subtle bg-surface p-4 shadow-[var(--shadow-1)] transition-colors hover:border-brand"
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-brand-soft">
          <Users size={18} className="text-brand" strokeWidth={1.75} />
        </span>
        <span>
          <span className="block font-medium">Usuarios</span>
          <span className="block text-label text-ink-3">
            Invitá a tu veterinario, tu capataz o tu contador, y decidí qué ve cada uno.
          </span>
        </span>
      </Link>
      <ConfigView catalogs={catalogs} currency={currency} params={params} flags={flags ?? []} rules={rules ?? []} />
    </div>
  );
}
