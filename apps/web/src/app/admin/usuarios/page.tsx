import Link from 'next/link';
import { adminApi, formatDateTime, formatDay, queryString } from '@/lib/admin-api';
import { Empty, PageHeader, Pager, Panel, Pill, TableWrap, Td, Th } from '../ui';
import { Filtros } from '../filtros';

export const dynamic = 'force-dynamic';

interface Row {
  id: string;
  name: string;
  email: string;
  email_verified: boolean;
  status: string;
  last_login_at: string | null;
  created_at: string;
  platform_role: string | null;
  organizations: { tenant_id: string; name: string; role: string }[];
}

const ESTADO: Record<string, string> = { active: 'Activo', blocked: 'Bloqueado', deleted: 'Eliminado' };

const ROL: Record<string, string> = {
  owner: 'Propietario',
  admin: 'Administrador',
  veterinarian: 'Veterinario',
  foreman: 'Capataz',
  worker: 'Operario',
  accountant: 'Contador',
};

export default async function UsuariosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const qs = queryString({ q: sp.q, status: sp.status, email_verified: sp.email_verified, offset: sp.offset });
  const { data, total, limit, offset } = await adminApi<{ data: Row[]; total: number; limit: number; offset: number }>(
    `/users${qs}`,
  );

  return (
    <>
      <PageHeader title="Usuarios" subtitle={`${total.toLocaleString('es')} personas registradas`} />

      <Filtros
        action="/admin/usuarios"
        buscar={{ name: 'q', placeholder: 'Buscar por nombre o email', value: sp.q }}
        selects={[
          {
            name: 'status',
            label: 'Estado',
            value: sp.status,
            options: [
              { value: 'active', label: 'Activo' },
              { value: 'blocked', label: 'Bloqueado' },
              { value: 'deleted', label: 'Eliminado' },
            ],
          },
          {
            name: 'email_verified',
            label: 'Email',
            value: sp.email_verified,
            options: [
              { value: 'true', label: 'Verificado' },
              { value: 'false', label: 'Sin verificar' },
            ],
          },
        ]}
      />

      <Panel title="Listado">
        {data.length === 0 ? (
          <Empty>Ningún usuario coincide con estos filtros.</Empty>
        ) : (
          <>
            <TableWrap>
              <thead>
                <tr>
                  <Th>Usuario</Th>
                  <Th>Email verificado</Th>
                  <Th>Estado</Th>
                  <Th>Organizaciones</Th>
                  <Th>Alta</Th>
                  <Th>Último ingreso</Th>
                </tr>
              </thead>
              <tbody>
                {data.map((u) => (
                  <tr key={u.id} className="hover:bg-sunken">
                    <Td>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-medium">{u.name}</span>
                        {/* Quién administra Cowinance se marca en el listado: si no, la única forma
                            de saberlo sería mirar la base. */}
                        {u.platform_role && (
                          <span className="rounded-full border border-brand/30 bg-brand/10 px-2 py-0.5 text-caption font-medium text-brand">
                            Plataforma · {u.platform_role}
                          </span>
                        )}
                      </div>
                      <div className="text-caption text-ink-3">{u.email}</div>
                    </Td>
                    <Td>
                      {u.email_verified ? (
                        <span className="text-success">Sí</span>
                      ) : (
                        <span className="text-warning">No</span>
                      )}
                    </Td>
                    <Td>
                      {/* Etiqueta explícita: el mapa por defecto de `Pill` está en femenino
                          («Activa») porque nació para organizaciones y suscripciones. Un usuario
                          es «Activo». */}
                      <Pill value={u.status} label={ESTADO[u.status] ?? u.status} />
                    </Td>
                    <Td>
                      {u.organizations.length === 0 ? (
                        <span className="text-ink-3">Sin organización</span>
                      ) : (
                        <div className="flex flex-col gap-0.5">
                          {u.organizations.map((o) => (
                            <span key={o.tenant_id}>
                              <Link href={`/admin/organizaciones/${o.tenant_id}`} className="text-brand hover:underline">
                                {o.name}
                              </Link>
                              <span className="text-ink-3"> · {ROL[o.role] ?? o.role}</span>
                            </span>
                          ))}
                        </div>
                      )}
                    </Td>
                    <Td className="whitespace-nowrap text-ink-2">{formatDay(u.created_at)}</Td>
                    <Td className="whitespace-nowrap text-ink-2">{formatDateTime(u.last_login_at)}</Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
            <Pager
              base={`/admin/usuarios${queryString({ q: sp.q, status: sp.status, email_verified: sp.email_verified })}`}
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
