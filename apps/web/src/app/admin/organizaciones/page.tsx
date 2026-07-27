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
  current_period_end: string | null;
  /** Días hasta el fin del período; negativo = vencido. Lo calcula el backend (regla única). */
  dias_para_vencer: number | null;
  max_animals: number | null;
  max_users: number | null;
  last_login_at: string | null;
}

export default async function OrganizacionesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  // Los filtros de ATENCIÓN llegan desde las tarjetas del resumen. Sin reenviarlos, esos enlaces
  // mostrarían el listado completo y parecería que la tarjeta miente.
  const atencion = { expiring: sp.expiring, idle: sp.idle, over_limit: sp.over_limit };
  const base = { q: sp.q, status: sp.status, country: sp.country, plan: sp.plan, ...atencion };
  const qs = queryString({ ...base, offset: sp.offset });
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

      {/* El filtro de atención se explica ARRIBA de la tabla y se puede quitar de un clic: si no,
          el operador ve «1 cuenta» sobre 15 y no sabe si filtró o si se rompió algo. */}
      <AvisoAtencion atencion={atencion} base={base} />

      <Filtros
        action="/admin/organizaciones"
        hidden={atencion}
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
                  <Th>Vence</Th>
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
                    <Td>
                      <Vencimiento dias={o.dias_para_vencer} fecha={o.current_period_end} />
                    </Td>
                    <Td className="whitespace-nowrap text-ink-2">{formatDay(o.created_at)}</Td>
                    <Td className="whitespace-nowrap text-ink-2">{formatDateTime(o.last_login_at)}</Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
            <Pager
              base={`/admin/organizaciones${queryString(base)}`}
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

/**
 * Cuánto le queda al período de la cuenta.
 *
 * El backend ya mandaba `current_period_end` y la tabla lo tiraba: el panel tenía el dato para
 * responder «¿qué pruebas vencen esta semana?» —la pregunta más comercial que existe— y no lo
 * mostraba.
 *
 * Se muestran los DÍAS y no solo la fecha. «12/08/2026» obliga a hacer la cuenta mentalmente por
 * cada fila; «en 3 d» se lee de un vistazo, que es lo que hace escaneable una tabla de 50 cuentas.
 * La fecha queda en el `title` para quien la necesite exacta.
 */
function Vencimiento({ dias, fecha }: { dias: number | null; fecha: string | null }) {
  if (dias === null || !fecha) return <span className="text-ink-3">—</span>;
  const tono = dias < 0 ? 'text-danger' : dias <= 7 ? 'text-warning' : 'text-ink-2';
  const texto = dias < 0 ? `venció hace ${Math.abs(dias)} d` : dias === 0 ? 'vence hoy' : `en ${dias} d`;
  return (
    <span className={`whitespace-nowrap ${tono}`} title={formatDay(fecha)}>
      {texto}
    </span>
  );
}

/**
 * Aviso de que la lista está acotada por un filtro que vino del resumen.
 *
 * Estos filtros no tienen control propio en la barra —llegan por enlace—, así que sin este cartel
 * la única pista de que están activos sería la URL. Un listado que muestra 1 de 15 cuentas sin decir
 * por qué se lee como un error del sistema.
 */
function AvisoAtencion({
  atencion,
  base,
}: {
  atencion: { expiring?: string; idle?: string; over_limit?: string };
  base: Record<string, string | undefined>;
}) {
  const textos: string[] = [];
  if (atencion.expiring) textos.push(`con el período venciendo en ${atencion.expiring} días o menos`);
  if (atencion.idle) textos.push(`sin ingresos hace ${atencion.idle} días o más`);
  if (atencion.over_limit) textos.push('que alcanzaron el límite de su plan');
  if (textos.length === 0) return null;

  const sinAtencion = { ...base, expiring: undefined, idle: undefined, over_limit: undefined };
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-label">
      <span>
        Mostrando solo las cuentas <span className="font-medium">{textos.join(' y ')}</span>.
      </span>
      <Link href={`/admin/organizaciones${queryString(sinAtencion)}`} className="font-medium text-brand hover:underline">
        Ver todas
      </Link>
    </div>
  );
}
