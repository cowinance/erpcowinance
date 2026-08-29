import { apiSafe } from '@/lib/server-api';
import { Card, CardTitle, EmptyState, TagMono } from '@/components/ui';
import { relativeTime } from '@/lib/format';
import { ResolveButton } from './ResolveButton';
import { RevokeDeviceButton } from './RevokeDeviceButton';
import { Smartphone, Tablet, Monitor, AlertTriangle, Copy, GitMerge } from 'lucide-react';

const PLATFORM_ICON: Record<string, any> = { ios: Smartphone, android: Tablet, web: Monitor };
const CONFLICT_META: Record<string, { label: string; icon: any }> = {
  semantic: { label: 'Semántico', icon: AlertTriangle },
  duplicate: { label: 'Duplicado', icon: Copy },
  concurrent_update: { label: 'Edición concurrente', icon: GitMerge },
};

export default async function SyncPage() {
  const [state, conflicts] = await Promise.all([apiSafe<any>('/sync/state'), apiSafe<any[]>('/sync/conflicts')]);
  if (!state) return <EmptyState title="La API no está disponible" body="Iniciá el backend con `npm run api` y recargá." />;

  const open = (conflicts ?? []).filter((c) => !c.resolved_at);
  const resolved = (conflicts ?? []).filter((c) => c.resolved_at);

  return (
    <div>
      <h1 className="text-xl font-semibold">Sincronización</h1>
      <p className="mt-0.5 mb-5 text-body text-ink-3">
        Panel de flota — estado de los dispositivos de campo y conflictos en revisión · cursor global{' '}
        <span className="tnum">{state.server_cursor}</span>
      </p>

      <Card>
        <CardTitle>Dispositivos ({state.devices.length})</CardTitle>
        {state.devices.length === 0 ? (
          <EmptyState
            title="Sin dispositivos registrados"
            body="Cuando la app móvil se registre (POST /v1/sync/devices), su estado de sincronización aparecerá acá."
          />
        ) : (
          <table className="w-full text-body">
            <thead>
              <tr className="h-8 border-b border-subtle text-left text-caption font-medium tracking-[0.06em] text-ink-3 uppercase">
                <th>Dispositivo</th>
                <th>Plataforma</th>
                <th>Versión</th>
                <th className="text-right">Changesets subidos</th>
                <th className="text-right">Cursor</th>
                <th className="text-right">Último sync</th>
                <th className="text-right">Estado</th>
                <th className="pr-1 text-right"></th>
              </tr>
            </thead>
            <tbody>
              {state.devices.map((d: any) => {
                const Icon = PLATFORM_ICON[d.platform] ?? Monitor;
                const fresh = d.last_sync_at && Date.now() - new Date(d.last_sync_at).getTime() < 24 * 3600000;
                // Hasta ahora la columna ignoraba `status`: un dispositivo dado de baja se mostraba
                // como «Atrasado», que invita a preguntar por qué no sincroniza en vez de decir que
                // ya no debe hacerlo.
                const revocado = d.status !== 'active';
                return (
                  <tr key={d.id} className="h-9 border-b border-subtle last:border-0">
                    <td className="font-medium">
                      <span className="inline-flex items-center gap-2">
                        <Icon size={15} strokeWidth={1.75} className="text-ink-2" />
                        {d.device_name ?? d.id.slice(0, 8)}
                      </span>
                    </td>
                    <td className="text-ink-2 capitalize">{d.platform}</td>
                    <td className="text-ink-2">{d.app_version ?? '—'}</td>
                    <td className="tnum text-right">{d.changesets_pushed}</td>
                    <td className="tnum text-right">{d.sync_cursor}</td>
                    <td className="text-right text-ink-2">{d.last_sync_at ? relativeTime(d.last_sync_at) : 'nunca'}</td>
                    <td className="text-right">
                      <span className="inline-flex items-center gap-1.5">
                        <span className={`size-2 rounded-full ${revocado ? 'bg-ink-3' : fresh ? 'bg-success' : 'bg-warning'}`} />
                        <span className="text-label text-ink-2">{revocado ? 'De baja' : fresh ? 'Al día' : 'Atrasado'}</span>
                      </span>
                    </td>
                    <td className="pr-1 text-right">
                      {!revocado && <RevokeDeviceButton deviceId={d.id} deviceName={d.device_name ?? d.platform} />}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      <Card className="mt-4">
        <CardTitle
          action={<span className="text-label text-ink-3">{open.length} abiertos · {resolved.length} resueltos</span>}
        >
          Conflictos en revisión
        </CardTitle>
        {open.length === 0 ? (
          <p className="py-6 text-center text-body text-ink-3">
            Sin conflictos pendientes — la convergencia automática resolvió todo.
          </p>
        ) : (
          <div className="space-y-2">
            {open.map((c: any) => {
              const meta = CONFLICT_META[c.conflict_type] ?? CONFLICT_META.semantic;
              const Icon = meta.icon;
              return (
                <div key={c.id} className="flex items-center gap-3 rounded-md border-l-[3px] border-warning bg-sunken px-3 py-2.5">
                  <Icon size={16} className="shrink-0 text-warning" strokeWidth={1.75} />
                  <div className="min-w-0 flex-1">
                    <div className="text-body font-medium">
                      {meta.label} · {c.entity_type}
                      {c.tag && (
                        <span className="text-ink-2">
                          {' '}
                          — caravana <TagMono>{c.tag}</TagMono>
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-label text-ink-2">{c.detail}</div>
                    <div className="mt-0.5 text-caption text-ink-3">{relativeTime(c.created_at)}</div>
                  </div>
                  <ResolveButton conflictId={c.id} />
                </div>
              );
            })}
          </div>
        )}
        {resolved.length > 0 && (
          <div className="mt-4 border-t border-subtle pt-3">
            {resolved.slice(0, 5).map((c: any) => (
              <div key={c.id} className="flex items-center gap-2 px-1 py-1 text-label text-ink-3">
                <span className="line-through">{c.detail}</span>
                <span className="ml-auto shrink-0">resuelto ({c.resolution})</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
