import Link from 'next/link';
import { adminApi, formatDateTime, queryString } from '@/lib/admin-api';
import { Empty, PageHeader, Pager, Panel, Pill, TableWrap, Td, Th } from '../ui';
import { Filtros } from '../filtros';

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
  es_accion: boolean;
}

interface Respuesta {
  data: Entrada[];
  total: number;
  limit: number;
  offset: number;
  facets: { actors: string[]; actions: string[] };
}

const RESULTADO: Record<string, string> = { ok: 'OK', denied: 'Rechazado', error: 'Error' };

/** Nombre legible de cada evento de dominio. Lo de navegación se muestra tal cual (`GET /ruta`). */
const ACCION: Record<string, string> = {
  'platform.login': 'Ingreso al panel',
  // Nombre ANTERIOR del mismo evento. Se mapea en vez de reescribir las filas viejas: una bitácora
  // que se edita para quedar prolija deja de servir como bitácora. Se interpreta la historia, no se
  // la corrige.
  'POST /v1/platform/auth/login': 'Ingreso al panel',
  'platform.bootstrap_superadmin': 'Alta de administrador',
  'organization.suspend': 'Suspendió la cuenta',
  'organization.reactivate': 'Reactivó la cuenta',
  'organization.change_plan': 'Cambió el plan',
  'user.block': 'Bloqueó al usuario',
  'user.unblock': 'Desbloqueó al usuario',
  'user.impersonate': 'Entró en modo espejo',
  'user.impersonate.end': 'Salió del modo espejo',
};

/**
 * Bitácora global del panel.
 *
 * ## Por qué arranca mostrando solo ACCIONES
 *
 * Medido sobre la bitácora real: de 99 entradas, 75 eran navegación del panel — 30 de ellas el
 * `GET /me` que cada página pedía. Las que justifican que este módulo exista (una suspensión, un
 * modo espejo) quedaban sepultadas, y con un tope de filas se iban de la ventana en un rato de uso.
 * Una auditoría que empeora cuanto más se usa el sistema no sirve para auditar.
 *
 * Ahora la vista arranca en «Acciones» —lo que cambió algo o entró a una finca— y los accesos están
 * a un clic. No se descartó nada: «quién miró esta finca» sigue siendo respondible, que es
 * justamente por lo que se registran las lecturas.
 */
export default async function AuditoriaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  // Por defecto, ACCIONES. Es la vista que responde «¿qué se hizo?»; para «¿quién miró?» está la
  // pestaña de al lado. Un `kind` explícito en la URL manda sobre el default.
  const kind = sp.kind ?? 'accion';
  const filtros = { kind, actor: sp.actor, action: sp.action, outcome: sp.outcome, tenant: sp.tenant, from: sp.from, to: sp.to };
  const { data, total, limit, offset, facets } = await adminApi<Respuesta>(
    `/audit-log${queryString({ ...filtros, offset: sp.offset })}`,
  );

  const base = (k: string) => `/admin/auditoria${queryString({ ...filtros, kind: k, offset: undefined })}`;
  const pestañas: [string, string][] = [
    ['accion', 'Acciones'],
    ['acceso', 'Accesos'],
    ['', 'Todo'],
  ];

  return (
    <>
      <PageHeader
        title="Auditoría de plataforma"
        subtitle={
          kind === 'accion'
            ? 'Lo que se hizo: cambios de estado y entradas a fincas de clientes'
            : kind === 'acceso'
              ? 'Lo que se miró: navegación del panel sobre datos de clientes'
              : 'Todo el registro, acciones y accesos'
        }
      />

      {/* Las pestañas conservan los demás filtros: cambiar de vista no debería obligar a volver a
          escribir el email que estabas rastreando. */}
      <div className="mb-4 flex gap-1">
        {pestañas.map(([valor, etiqueta]) => (
          <Link
            key={valor || 'todo'}
            href={base(valor)}
            className={`h-8 rounded-md px-3 text-label font-medium leading-8 ${
              kind === valor ? 'bg-brand/15 text-brand' : 'text-ink-2 hover:bg-sunken'
            }`}
          >
            {etiqueta}
          </Link>
        ))}
      </div>

      <Filtros
        action="/admin/auditoria"
        hidden={{ kind }}
        buscar={{ name: 'actor', placeholder: 'Filtrar por email del administrador', value: sp.actor }}
        selects={[
          {
            name: 'action',
            label: 'Acción',
            value: sp.action,
            options: facets.actions.map((a) => ({ value: a, label: ACCION[a] ?? a })),
          },
          {
            name: 'outcome',
            label: 'Resultado',
            value: sp.outcome,
            options: [
              { value: 'ok', label: 'OK' },
              { value: 'denied', label: 'Rechazado' },
              { value: 'error', label: 'Error' },
            ],
          },
        ]}
        fechas={[
          { name: 'from', label: 'Desde', value: sp.from },
          { name: 'to', label: 'Hasta', value: sp.to },
        ]}
      />

      <Panel title={`Registro (${total.toLocaleString('es')})`}>
        {data.length === 0 ? (
          <Empty>No hay entradas con esos filtros.</Empty>
        ) : (
          <>
            <TableWrap>
              <thead>
                <tr>
                  <Th>Cuándo</Th>
                  <Th>Quién</Th>
                  <Th>Qué</Th>
                  <Th>Resultado</Th>
                  <Th>Sobre</Th>
                  <Th>Origen</Th>
                </tr>
              </thead>
              <tbody>
                {data.map((e) => (
                  <tr key={e.id} className={e.outcome === 'denied' ? 'bg-danger/5' : undefined}>
                    <Td className="whitespace-nowrap text-ink-2">{formatDateTime(e.occurred_at)}</Td>
                    <Td>
                      {e.actor_email ?? <span className="text-ink-3">anónimo</span>}
                      {e.actor_role && <div className="text-caption text-ink-3">{e.actor_role}</div>}
                    </Td>
                    <Td>
                      {e.es_accion ? (
                        <span className="font-medium">{ACCION[e.action] ?? e.action}</span>
                      ) : (
                        <span className="font-mono text-caption text-ink-2">{e.action}</span>
                      )}
                      {/* El MOTIVO es la mitad del valor de la bitácora: «suspendió la cuenta» no
                          sirve tres meses después; «por falta de pago de la factura 1042», sí. */}
                      {typeof (e.detail as any)?.motivo === 'string' && (
                        <div className="text-caption text-ink-3">«{(e.detail as any).motivo}»</div>
                      )}
                    </Td>
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
                      {e.detail && Object.keys((e.detail as any).query ?? {}).length > 0 && (
                        <div className="text-caption text-ink-3">{JSON.stringify((e.detail as any).query)}</div>
                      )}
                    </Td>
                    <Td className="whitespace-nowrap text-ink-3">{e.ip_address ?? '—'}</Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
            <Pager base={`/admin/auditoria${queryString(filtros)}`} total={total} limit={limit} offset={offset} />
          </>
        )}
      </Panel>
    </>
  );
}
