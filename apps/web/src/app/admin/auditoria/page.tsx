import Link from 'next/link';
import { adminApi, formatDateTime } from '@/lib/admin-api';
import { Empty, PageHeader, Panel, Pill, TableWrap, Td, Th } from '../ui';

export const dynamic = 'force-dynamic';

interface Entrada {
  id: string;
  actor_email: string | null;
  actor_role: string | null;
  action: string;
  outcome: string;
  target_type: string | null;
  target_id: string | null;
  target_tenant_id: string | null;
  detail: Record<string, unknown> | null;
  ip_address: string | null;
  occurred_at: string;
}

const RESULTADO: Record<string, string> = { ok: 'OK', denied: 'Rechazado', error: 'Error' };

/**
 * Bitácora global del panel.
 *
 * Está a la vista y no escondida en la base a propósito: un panel que ve los datos de todos los
 * clientes necesita que sus propios accesos sean auditables POR el equipo, no solo por quien sepa
 * escribir SQL. Se registran también las lecturas — en un panel de solo lectura, «quién miró qué»
 * es exactamente el evento que importa.
 */
export default async function AuditoriaPage() {
  const entradas = await adminApi<Entrada[]>('/audit-log?limit=200');

  return (
    <>
      <PageHeader title="Auditoría de plataforma" subtitle="Últimos 200 accesos al panel, incluidos los rechazados" />
      <Panel title="Bitácora">
        {entradas.length === 0 ? (
          <Empty>Todavía no hay actividad registrada.</Empty>
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <Th>Cuándo</Th>
                <Th>Quién</Th>
                <Th>Acción</Th>
                <Th>Resultado</Th>
                <Th>Objeto</Th>
                <Th>Origen</Th>
              </tr>
            </thead>
            <tbody>
              {entradas.map((e) => (
                <tr key={e.id} className={e.outcome === 'denied' ? 'bg-danger/5' : undefined}>
                  <Td className="whitespace-nowrap text-ink-2">{formatDateTime(e.occurred_at)}</Td>
                  <Td>
                    {e.actor_email ?? <span className="text-ink-3">anónimo</span>}
                    {e.actor_role && <div className="text-caption text-ink-3">{e.actor_role}</div>}
                  </Td>
                  <Td className="font-mono text-caption">{e.action}</Td>
                  <Td>
                    <Pill
                      value={e.outcome === 'ok' ? 'active' : e.outcome === 'denied' ? 'blocked' : 'churned'}
                      label={RESULTADO[e.outcome] ?? e.outcome}
                    />
                  </Td>
                  <Td>
                    {e.target_tenant_id ? (
                      <Link href={`/admin/organizaciones/${e.target_tenant_id}`} className="text-brand hover:underline">
                        {e.target_type ?? 'organización'}
                      </Link>
                    ) : (
                      <span className="text-ink-3">{e.target_id ?? '—'}</span>
                    )}
                    {/* Los filtros de la consulta viajan en `detail`: un email tecleado en el
                        buscador ES el dato relevante de una consulta de soporte. */}
                    {e.detail && Object.keys((e.detail as any).query ?? {}).length > 0 && (
                      <div className="text-caption text-ink-3">{JSON.stringify((e.detail as any).query)}</div>
                    )}
                  </Td>
                  <Td className="whitespace-nowrap text-ink-3">{e.ip_address ?? '—'}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Panel>
    </>
  );
}
