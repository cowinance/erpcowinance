import Link from 'next/link';
import { adminApi, formatBytes, formatDateTime } from '@/lib/admin-api';
import { Empty, PageHeader, Panel, Pill, Stat, TableWrap, Td, Th } from './ui';

export const dynamic = 'force-dynamic';

interface Dashboard {
  organizations: Record<string, number>;
  users: Record<string, number>;
  herd: { active_animals: number };
  devices: { active: number; total: number };
  storage: { files: number; bytes: string };
  plans: { code: string; name: string; total: number; by_status: Record<string, number> }[];
  recent: {
    organizations: { id: string; name: string; country_code: string; status: string; created_at: string }[];
    logins: { id: string; name: string; email: string; last_login_at: string }[];
  };
}

const n = (v?: number) => (v ?? 0).toLocaleString('es');

export default async function AdminDashboard() {
  const d = await adminApi<Dashboard>('/dashboard');
  const o = d.organizations;
  const u = d.users;

  return (
    <>
      <PageHeader title="Resumen de la plataforma" subtitle="Estado global de cuentas, usuarios y uso del sistema" />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Organizaciones"
          value={n(o.total)}
          hint={`${n(o.active)} activas · ${n(o.suspended)} suspendidas · ${n(o.churned)} de baja`}
        />
        <Stat label="Usuarios" value={n(u.total)} hint={`${n(u.active)} activos · ${n(u.blocked)} bloqueados`} />
        <Stat
          label="Email verificado"
          value={n(u.email_verified)}
          hint={`${n(u.email_unverified)} sin verificar`}
          tone={u.email_unverified > u.email_verified ? 'warning' : undefined}
        />
        <Stat label="Animales activos" value={n(d.herd.active_animals)} hint="en todas las fincas" />
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Altas (30 días)" value={n(o.created_30d)} hint={`${n(o.created_7d)} en los últimos 7`} />
        <Stat label="Usuarios que entraron (7 días)" value={n(u.logged_in_7d)} hint={`${n(u.logged_in_30d)} en 30 días`} />
        <Stat label="Dispositivos activos" value={n(d.devices.active)} hint={`${n(d.devices.total)} registrados`} />
        <Stat label="Almacenamiento" value={formatBytes(d.storage.bytes)} hint={`${n(d.storage.files)} archivos`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Planes y suscripciones">
          {d.plans.length === 0 ? (
            <Empty>Todavía no hay suscripciones.</Empty>
          ) : (
            <TableWrap ancho="angosto">
              <thead>
                <tr>
                  <Th>Plan</Th>
                  <Th align="right">Cuentas</Th>
                  <Th>Estados</Th>
                </tr>
              </thead>
              <tbody>
                {d.plans.map((p) => (
                  <tr key={p.code}>
                    <Td>{p.name}</Td>
                    <Td align="right">{n(p.total)}</Td>
                    <Td>
                      <div className="flex flex-wrap gap-1">
                        {Object.entries(p.by_status).map(([estado, cant]) => (
                          <Pill key={estado} value={estado} label={`${cant}`} />
                        ))}
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </Panel>

        <Panel
          title="Cuentas recientes"
          action={
            <Link href="/admin/organizaciones" className="text-label font-medium text-brand hover:underline">
              Ver todas
            </Link>
          }
        >
          {d.recent.organizations.length === 0 ? (
            <Empty>Sin altas recientes.</Empty>
          ) : (
            <TableWrap ancho="angosto">
              <thead>
                <tr>
                  <Th>Organización</Th>
                  <Th>Estado</Th>
                  <Th>Alta</Th>
                </tr>
              </thead>
              <tbody>
                {d.recent.organizations.map((org) => (
                  <tr key={org.id}>
                    <Td>
                      <Link href={`/admin/organizaciones/${org.id}`} className="font-medium text-brand hover:underline">
                        {org.name}
                      </Link>
                      <span className="ml-1 text-caption text-ink-3">{org.country_code}</span>
                    </Td>
                    <Td>
                      <Pill value={org.status} />
                    </Td>
                    <Td className="whitespace-nowrap text-ink-2">{formatDateTime(org.created_at)}</Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </Panel>

        <Panel
          title="Últimos ingresos"
          action={
            <Link href="/admin/usuarios" className="text-label font-medium text-brand hover:underline">
              Ver usuarios
            </Link>
          }
        >
          {d.recent.logins.length === 0 ? (
            <Empty>Nadie ingresó todavía.</Empty>
          ) : (
            <TableWrap ancho="angosto">
              <thead>
                <tr>
                  <Th>Usuario</Th>
                  <Th>Último ingreso</Th>
                </tr>
              </thead>
              <tbody>
                {d.recent.logins.map((usuario) => (
                  <tr key={usuario.id}>
                    <Td>
                      <div className="font-medium">{usuario.name}</div>
                      <div className="text-caption text-ink-3">{usuario.email}</div>
                    </Td>
                    <Td className="whitespace-nowrap text-ink-2">{formatDateTime(usuario.last_login_at)}</Td>
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
