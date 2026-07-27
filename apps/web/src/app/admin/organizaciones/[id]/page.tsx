import Link from 'next/link';
import { adminApi, formatBytes, formatDateTime, formatDay } from '@/lib/admin-api';
import { Empty, PageHeader, Panel, Pill, Stat, TableWrap, Td, Th } from '../../ui';
import { AccionesOrganizacion } from './AccionesOrganizacion';

export const dynamic = 'force-dynamic';

interface Detalle {
  organization: {
    id: string;
    name: string;
    legal_name: string | null;
    country_code: string;
    default_currency: string;
    timezone: string;
    status: string;
    created_at: string;
    plan_name: string | null;
    subscription_status: string | null;
  };
  users: {
    id: string;
    name: string;
    email: string;
    email_verified: boolean;
    status: string;
    role: string | null;
    last_login_at: string | null;
    created_at: string;
  }[];
  farms: {
    id: string;
    name: string;
    official_code: string | null;
    total_area_ha: number | null;
    is_active: boolean;
    timezone: string | null;
    company_name: string | null;
  }[];
  subscription: {
    status: string;
    billing_currency: string;
    current_period_start: string;
    current_period_end: string;
    plan_code: string;
    plan_name: string;
    monthly_price_usd: number;
    max_animals: number | null;
    max_users: number | null;
    max_devices: number | null;
  } | null;
  payments: { id: string; amount: number; currency: string; status: string; gateway: string; paid_at: string | null }[];
  usage: {
    active_animals: number;
    total_animals: number;
    users: number;
    active_devices: number;
    files: number;
    storage_bytes: string;
    farms: number;
  };
  activity: {
    last_animal_at: string | null;
    animals_30d: number;
    last_file_at: string | null;
    files_30d: number;
    last_sync_at: string | null;
    last_login_at: string | null;
  };
}

const ROL: Record<string, string> = {
  owner: 'Propietario',
  admin: 'Administrador',
  veterinarian: 'Veterinario',
  foreman: 'Capataz',
  worker: 'Operario',
  accountant: 'Contador',
};

/** «3 de 1.000» o «3» si el plan no pone techo. `null` = sin límite, no «cero». */
function contraLimite(uso: number, limite: number | null | undefined): string {
  return limite == null ? uso.toLocaleString('es') : `${uso.toLocaleString('es')} de ${limite.toLocaleString('es')}`;
}

export default async function OrganizacionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // En paralelo: el detalle, qué puede hacer QUIEN MIRA (el servidor resuelve los permisos) y el
  // catálogo de planes para el selector. Tres llamadas independientes; encadenarlas sumaría dos
  // viajes a una pantalla que ya hace bastante trabajo.
  const [d, yo, planes] = await Promise.all([
    adminApi<Detalle>(`/organizations/${id}`),
    adminApi<{ actions: string[] }>('/me'),
    adminApi<{ code: string; name: string }[]>('/plans'),
  ]);
  const acciones = yo.actions ?? [];
  const o = d.organization;
  const s = d.subscription;

  return (
    <>
      <PageHeader
        title={o.name}
        subtitle={[o.legal_name, o.country_code, o.default_currency, o.timezone].filter(Boolean).join(' · ')}
        action={
          <div className="flex items-center gap-4">
            {/* «¿Qué le hicimos a esta cuenta?» respondida desde la cuenta, que es donde surge la
                pregunta. Antes había que ir a la bitácora y leerla entera a ojo. */}
            <Link href={`/admin/auditoria?kind=&tenant=${o.id}`} className="text-label text-brand hover:underline">
              Ver actividad del panel sobre esta cuenta
            </Link>
            <Link href="/admin/organizaciones" className="text-label text-ink-2 hover:underline">
              ← Volver al listado
            </Link>
          </div>
        }
      />

      <AccionesOrganizacion
        id={o.id}
        nombre={o.name}
        estado={o.status}
        planActual={s?.plan_code}
        acciones={acciones}
        planes={planes}
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Estado de la cuenta" value={o.status === 'active' ? 'Activa' : o.status === 'suspended' ? 'Suspendida' : 'Baja'} hint={`Alta el ${formatDay(o.created_at)}`} />
        <Stat label="Animales activos" value={contraLimite(d.usage.active_animals, s?.max_animals)} hint={`${d.usage.total_animals.toLocaleString('es')} históricos`} />
        <Stat label="Usuarios" value={contraLimite(d.usage.users, s?.max_users)} hint={`${d.usage.farms} finca(s)`} />
        <Stat label="Almacenamiento" value={formatBytes(d.usage.storage_bytes)} hint={`${d.usage.files.toLocaleString('es')} archivos`} />
      </div>

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Panel title="Suscripción">
          {!s ? (
            <Empty>Esta organización todavía no tiene suscripción.</Empty>
          ) : (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 px-4 py-4 text-body">
              <Dato termino="Plan" valor={`${s.plan_name} · US$ ${s.monthly_price_usd.toLocaleString('es')}/mes`} />
              <Dato termino="Estado" valor={<Pill value={s.status} />} />
              <Dato termino="Período actual" valor={`${formatDay(s.current_period_start)} → ${formatDay(s.current_period_end)}`} />
              <Dato termino="Moneda de cobro" valor={s.billing_currency} />
              <Dato termino="Dispositivos" valor={contraLimite(d.usage.active_devices, s.max_devices)} />
            </dl>
          )}
          {d.payments.length > 0 && (
            <TableWrap ancho="angosto">
              <thead>
                <tr>
                  <Th>Pago</Th>
                  <Th>Estado</Th>
                  <Th>Pasarela</Th>
                  <Th>Fecha</Th>
                </tr>
              </thead>
              <tbody>
                {d.payments.map((p) => (
                  <tr key={p.id}>
                    <Td>{`${p.currency} ${p.amount.toLocaleString('es')}`}</Td>
                    <Td>
                      <Pill value={p.status} label={p.status} />
                    </Td>
                    <Td>{p.gateway}</Td>
                    <Td className="whitespace-nowrap text-ink-2">{formatDateTime(p.paid_at)}</Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </Panel>

        <Panel title="Actividad reciente">
          {/* Señales de que la cuenta se USA, no contenido de la finca: el panel no lee sanidad,
              ventas ni sueldos (la RLS se lo impide). Para soporte esto es lo que hace falta:
              ¿está viva la cuenta, sincronizan, entra alguien? */}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 px-4 py-4 text-body">
            <Dato termino="Último ingreso de un usuario" valor={formatDateTime(d.activity.last_login_at)} />
            <Dato termino="Última sincronización" valor={formatDateTime(d.activity.last_sync_at)} />
            <Dato termino="Última alta de animal" valor={formatDateTime(d.activity.last_animal_at)} />
            <Dato termino="Animales cargados (30 días)" valor={d.activity.animals_30d.toLocaleString('es')} />
            <Dato termino="Última foto o documento" valor={formatDateTime(d.activity.last_file_at)} />
            <Dato termino="Archivos subidos (30 días)" valor={d.activity.files_30d.toLocaleString('es')} />
          </dl>
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={`Usuarios (${d.users.length})`}>
          {d.users.length === 0 ? (
            <Empty>Esta organización no tiene usuarios.</Empty>
          ) : (
            <TableWrap ancho="angosto">
              <thead>
                <tr>
                  <Th>Usuario</Th>
                  <Th>Rol</Th>
                  {/* La columna es el ESTADO de verificación; el email va bajo «Usuario», junto al
                      nombre. Rotularla «Email» hacía leer «Sin verificar» como si fuera la dirección.
                      Mismo rótulo que en el listado de usuarios, para que las dos tablas se lean igual. */}
                  <Th>Email verificado</Th>
                  <Th>Último ingreso</Th>
                </tr>
              </thead>
              <tbody>
                {d.users.map((u) => (
                  <tr key={u.id}>
                    <Td>
                      <div className="font-medium">{u.name}</div>
                      <div className="text-caption text-ink-3">{u.email}</div>
                    </Td>
                    <Td>{u.role ? (ROL[u.role] ?? u.role) : '—'}</Td>
                    <Td>{u.email_verified ? <span className="text-success">Verificado</span> : <span className="text-warning">Sin verificar</span>}</Td>
                    <Td className="whitespace-nowrap text-ink-2">{formatDateTime(u.last_login_at)}</Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </Panel>

        <Panel title={`Fincas (${d.farms.length})`}>
          {d.farms.length === 0 ? (
            <Empty>Esta organización todavía no cargó fincas.</Empty>
          ) : (
            <TableWrap ancho="angosto">
              <thead>
                <tr>
                  <Th>Finca</Th>
                  <Th>Empresa</Th>
                  <Th align="right">Superficie</Th>
                  <Th>Estado</Th>
                </tr>
              </thead>
              <tbody>
                {d.farms.map((f) => (
                  <tr key={f.id}>
                    <Td>
                      <div className="font-medium">{f.name}</div>
                      {f.official_code && <div className="text-caption text-ink-3">{f.official_code}</div>}
                    </Td>
                    <Td>{f.company_name ?? '—'}</Td>
                    <Td align="right">{f.total_area_ha != null ? `${f.total_area_ha.toLocaleString('es')} ha` : '—'}</Td>
                    <Td>{f.is_active ? <span className="text-success">Activa</span> : <span className="text-ink-3">Inactiva</span>}</Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </Panel>
      </div>
    </>
  );
}

function Dato({ termino, valor }: { termino: string; valor: React.ReactNode }) {
  return (
    <div>
      <dt className="text-label text-ink-2">{termino}</dt>
      <dd className="mt-0.5">{valor}</dd>
    </div>
  );
}
