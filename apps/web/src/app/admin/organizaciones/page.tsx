import Link from 'next/link';
import { adminApi, formatDateTime, formatDay, queryString } from '@/lib/admin-api';
import { Empty, PageHeader, Pager, Panel, Pill, TableWrap, Td, Th } from '../ui';
import { Filtros } from '../filtros';

export const dynamic = 'force-dynamic';

interface Row {
  id: string;
  name: string;
  country_code: string;
  default_currency: string;
  status: string;
  created_at: string;
  users: number;
  animals: number;
  plan_code: string | null;
  plan_name: string | null;
  subscription_status: string | null;
  last_login_at: string | null;
}

export default async function OrganizacionesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const qs = queryString({ q: sp.q, status: sp.status, country: sp.country, plan: sp.plan, offset: sp.offset });
  const { data, total, limit, offset, facets } = await adminApi<{
    data: Row[];
    total: number;
    limit: number;
    offset: number;
    facets: { countries: string[] };
  }>(`/organizations${qs}`);

  // El catálogo de planes sale del dashboard: son los planes que REALMENTE tienen suscripciones, no
  // el catálogo entero. Filtrar por un plan que nadie contrató da una tabla vacía y confunde.
  const { plans } = await adminApi<{ plans: { code: string; name: string }[] }>('/dashboard');

  return (
    <>
      <PageHeader title="Organizaciones" subtitle={`${total.toLocaleString('es')} cuentas en la plataforma`} />

      <Filtros
        action="/admin/organizaciones"
        buscar={{ name: 'q', placeholder: 'Buscar por nombre o razón social', value: sp.q }}
        selects={[
          {
            name: 'status',
            label: 'Estado',
            value: sp.status,
            options: [
              { value: 'active', label: 'Activa' },
              { value: 'suspended', label: 'Suspendida' },
              { value: 'churned', label: 'Baja' },
            ],
          },
          {
            name: 'country',
            label: 'País',
            value: sp.country,
            // Del backend, no de `data`: las opciones tienen que ser las del conjunto completo, o
            // filtrar por un país deja ese país como única opción disponible.
            options: facets.countries.map((c) => ({ value: c, label: c })),
          },
          {
            name: 'plan',
            label: 'Plan',
            value: sp.plan,
            options: plans.map((p) => ({ value: p.code, label: p.name })),
          },
        ]}
      />

      <Panel title="Listado">
        {data.length === 0 ? (
          <Empty>Ninguna organización coincide con estos filtros.</Empty>
        ) : (
          <>
            <TableWrap>
              <thead>
                <tr>
                  <Th>Organización</Th>
                  <Th>País</Th>
                  <Th>Moneda</Th>
                  <Th>Estado</Th>
                  <Th align="right">Usuarios</Th>
                  <Th align="right">Animales</Th>
                  <Th>Plan</Th>
                  <Th>Suscripción</Th>
                  <Th>Alta</Th>
                  <Th>Último ingreso</Th>
                </tr>
              </thead>
              <tbody>
                {data.map((o) => (
                  <tr key={o.id} className="hover:bg-sunken">
                    <Td>
                      <Link href={`/admin/organizaciones/${o.id}`} className="font-medium text-brand hover:underline">
                        {o.name}
                      </Link>
                    </Td>
                    <Td>{o.country_code}</Td>
                    <Td>{o.default_currency}</Td>
                    <Td>
                      <Pill value={o.status} />
                    </Td>
                    <Td align="right">{o.users.toLocaleString('es')}</Td>
                    <Td align="right">{o.animals.toLocaleString('es')}</Td>
                    <Td>{o.plan_name ?? <span className="text-ink-3">Sin plan</span>}</Td>
                    <Td>
                      <Pill value={o.subscription_status} />
                    </Td>
                    <Td className="whitespace-nowrap text-ink-2">{formatDay(o.created_at)}</Td>
                    <Td className="whitespace-nowrap text-ink-2">{formatDateTime(o.last_login_at)}</Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
            <Pager
              base={`/admin/organizaciones${queryString({ q: sp.q, status: sp.status, country: sp.country, plan: sp.plan })}`}
              total={total}
              limit={limit}
              offset={offset}
            />
          </>
        )}
      </Panel>
    </>
  );
}
