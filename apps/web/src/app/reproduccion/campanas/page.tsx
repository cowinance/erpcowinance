import { cryoLocationLabel } from '@cowinance/domain';
import { apiSafe } from '@/lib/server-api';
import { EmptyState } from '@/components/ui';
import { CampaignPlanner } from './CampaignPlanner';

/**
 * Campaña de servicio (GT-3): la jornada de IATF/TE de un lote, vientre por vientre.
 *
 * La campaña elegida viaja por la URL, igual que el termo: así el enlace a «la IATF del 15 de
 * junio» se puede compartir y recargar.
 */
export default async function CampaignsPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const { id } = await searchParams;
  const assignments = await apiSafe<any[]>('/reproduction/protocol-assignments');
  if (assignments === null) {
    return <EmptyState title="La API no está disponible" body="Iniciá el backend con `npm run api` y recargá." />;
  }
  const activas = (assignments ?? []).filter((a) => a.status === 'active');
  const elegida = id ?? activas[0]?.id;

  if (!elegida)
    return (
      <div className="space-y-6">
        <h1 className="text-xl font-semibold">Campañas</h1>
        <EmptyState
          title="No hay campañas activas"
          body="Asigná un protocolo a un lote desde Protocolos: eso crea la campaña y sus tareas."
        />
      </div>
    );

  // El origen y sus pajuelas LIBRES: es lo que se puede reservar hoy. Las reservadas no aparecen
  // porque ya tienen dueña, y ofrecerlas sería ofrecer algo que va a rebotar con un 409.
  const [campaign, picking, outcome, batches, embryos] = await Promise.all([
    apiSafe<any>(`/reproduction/campaigns/${elegida}`),
    apiSafe<any>(`/reproduction/campaigns/${elegida}/picking-list`),
    apiSafe<any>(`/reproduction/campaigns/${elegida}/outcome`),
    apiSafe<any[]>('/genetics/semen'),
    apiSafe<any[]>('/genetics/embryos'),
  ]);

  const conStock = [
    ...(batches ?? []).filter((b) => b.straws_available > 0).map((b) => ({ id: b.id, kind: 'semen' as const, label: `Semen · ${b.sire_tag ?? b.sire_name_external ?? b.batch_code}` })),
    ...(embryos ?? []).filter((e) => e.straws_available > 0).map((e) => ({ id: e.id, kind: 'embryo' as const, label: `Embrión · ${[e.stage, e.grade].filter(Boolean).join(' ') || 'colecta'}` })),
  ];
  const origins = await Promise.all(
    conStock.map(async (o) => {
      const query = o.kind === 'semen' ? `semen_batch_id=${o.id}` : `embryo_id=${o.id}`;
      const unidades = (await apiSafe<any[]>(`/genetics/straws?${query}`)) ?? [];
      return {
        ...o,
        straws: unidades
          .filter((s) => s.status === 'stored')
          .map((s) => ({
            id: s.id,
            label:
              cryoLocationLabel({
                tank_code: s.tank_code,
                canister_code: s.canister_code,
                canister_color: s.canister_color,
                goblet_code: s.goblet_code,
              }) || (s.code ? `código ${s.code}` : 'sin ubicar'),
          })),
      };
    }),
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Campañas de servicio</h1>
        <p className="mt-0.5 text-body text-ink-3">
          Qué se le pone a cada vientre y de qué pajuela sale. La campaña no termina al inseminar: termina cuando se
          confirma la preñez.
        </p>
      </div>

      {activas.length > 1 && (
        <nav className="tab-strip flex gap-1 border-b border-subtle">
          {activas.map((a) => (
            <a
              key={a.id}
              href={`/reproduccion/campanas?id=${a.id}`}
              className={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-body font-medium ${a.id === elegida ? 'border-brand text-brand' : 'border-transparent text-ink-3 hover:text-ink-1'}`}
            >
              {a.protocol_name ?? 'Campaña'} · {a.start_date}
            </a>
          ))}
        </nav>
      )}

      {!campaign ? (
        <EmptyState title="No se pudo cargar la campaña" body="Probá recargar la página." />
      ) : (
        <CampaignPlanner
          assignmentId={elegida}
          summary={campaign.summary}
          rows={campaign.animals}
          origins={origins}
          picking={picking?.lines ?? []}
          outcome={outcome?.outcome ?? { served: 0, pregnant: 0, empty: 0, doubtful: 0, pending_diagnosis: 0, conception_rate: null, closed: false }}
          bySire={outcome?.by_sire ?? []}
          outcomeRows={outcome?.animals ?? []}
        />
      )}
    </div>
  );
}
