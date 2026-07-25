'use client';

/**
 * Ficha 360 del animal (A360 E3) — pestañas que COMPONEN las fuentes existentes sin
 * duplicar lógica: Resumen (timeline filtrable + curva + pesaje + fotos), Sanidad
 * (overview: tratamientos/vacunas/casos), Reproducción (estado real de ReproService),
 * Movimientos (overview + tiempo en lote), Genealogía (madre/padre/crías). Las acciones
 * rápidas enlazan a los módulos correspondientes (no reimplementan captura).
 */
import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Baby, Clock, Heart, MapPin, Pencil, Scale, Stethoscope, Syringe, StickyNote, Milk, Filter, Tag, ShoppingCart,
} from 'lucide-react';
import { Card, CardTitle } from '@/components/ui';
import { WeightChart } from '@/components/WeightChart';
import { EVENT_LABELS, ageFrom, formatDate, formatKg, relativeTime } from '@/lib/format';
import { WeighingForm } from './WeighingForm';
import { PhotoGallery } from './PhotoGallery';
import { IdentifiersManager } from './IdentifiersManager';

const EVENT_ICON: Record<string, any> = {
  birth: Baby, weighing: Scale, treatment: Stethoscope, vaccination: Syringe,
  pregnancy_diagnosed: Heart, note: StickyNote, edit: Pencil, movement: MapPin,
  purchase: ShoppingCart, transfer: MapPin,
  identifier_added: Tag, identifier_retired: Tag, identifier_official: Tag,
};

const REPRO_LABELS: Record<string, string> = {
  pregnant: 'Preñada', due_soon: 'Próxima a parir', served: 'Servida', diagnosis_pending: 'Diagnóstico pendiente',
  in_protocol: 'En protocolo', aborted: 'Aborto reciente', postpartum_rest: 'Descanso postparto',
  ready_for_review: 'Lista para revisar', ready_for_service: 'Lista para servicio', repeat_breeder: 'Repetidora',
  open: 'Vacía (abierta)', empty: 'Vacía', culled: 'Descartada',
};

const MOVE_LABEL: Record<string, string> = { ingreso: 'Ingreso', salida: 'Salida', rotacion: 'Rotación', movimiento: 'Movimiento' };

export function AnimalTabs({
  animal,
  timeline,
  overview,
  reproStatus,
  genealogy,
}: {
  animal: any;
  timeline: any[];
  overview: any;
  reproStatus: any;
  genealogy?: any;
}) {
  const isFemale = animal.sex === 'F';
  const tabs = ['Resumen', 'Sanidad', ...(isFemale ? ['Reproducción'] : []), 'Movimientos', 'Genealogía'];
  const [tab, setTab] = useState('Resumen');
  const health = overview?.health;
  const openCases = health?.open_cases ?? [];
  const treatments = health?.treatments ?? [];
  const vaccinations = health?.vaccinations ?? [];
  const movements = overview?.movements ?? [];

  const healthBadge = openCases.length + (health?.vaccination_overdue ?? 0);

  return (
    <div>
      {/* Barra de pestañas */}
      <div className="mb-4 tab-strip flex gap-1 border-b border-subtle">
        {tabs.map((t) => {
          const badge = t === 'Sanidad' ? healthBadge : t === 'Movimientos' ? movements.length : 0;
          return (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`relative -mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-body font-medium ${
                tab === t ? 'border-brand text-brand' : 'border-transparent text-ink-2 hover:text-ink'
              }`}
            >
              {t}
              {badge > 0 && (
                <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-caption ${t === 'Sanidad' && healthBadge ? 'bg-warning/15 text-warning' : 'bg-sunken text-ink-3'}`}>{badge}</span>
              )}
            </button>
          );
        })}
      </div>

      {tab === 'Resumen' && <ResumenTab animal={animal} timeline={timeline} />}
      {tab === 'Sanidad' && <SanidadTab treatments={treatments} vaccinations={vaccinations} openCases={openCases} animalTag={animal.identifiers?.find((i: any) => i.type === 'visual')?.value} />}
      {tab === 'Reproducción' && isFemale && <ReproTab status={reproStatus} />}
      {tab === 'Movimientos' && <MovimientosTab movements={movements} daysInLot={overview?.days_in_current_lot} lotName={animal.lot_name} paddockName={animal.paddock_name} />}
      {tab === 'Genealogía' && <GenealogiaTab animal={animal} genealogy={genealogy} milk={overview?.production?.milk_30d} calvings={overview?.production?.calvings} />}
    </div>
  );
}

function ResumenTab({ animal, timeline }: { animal: any; timeline: any[] }) {
  const [filter, setFilter] = useState('');
  const types = useMemo(() => Array.from(new Set((timeline ?? []).map((e) => e.event_type))), [timeline]);
  const shown = filter ? (timeline ?? []).filter((e) => e.event_type === filter) : timeline ?? [];

  return (
    <div className="grid grid-cols-5 gap-4 max-lg:grid-cols-1">
      <Card className="col-span-3">
        <div className="mb-3 flex items-center justify-between">
          <CardTitle>Línea de tiempo</CardTitle>
          <div className="flex items-center gap-1.5 text-label text-ink-3">
            <Filter size={13} />
            <select value={filter} onChange={(e) => setFilter(e.target.value)} className="h-7 rounded-md border border-strong bg-surface px-2 text-label outline-none focus:ring-2 focus:ring-brand">
              <option value="">Todos los eventos</option>
              {types.map((t) => (
                <option key={t} value={t}>{EVENT_LABELS[t] ?? t}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="relative ml-2 space-y-4 border-l border-subtle pl-5">
          {shown.map((e: any) => {
            const Icon = EVENT_ICON[e.event_type] ?? StickyNote;
            return (
              <div key={e.id} className="relative">
                <div className="absolute top-0.5 -left-[27.5px] flex size-5 items-center justify-center rounded-full border border-subtle bg-surface">
                  <Icon size={11} strokeWidth={2} className="text-ink-2" />
                </div>
                <div className="text-body">
                  <span className="font-medium">{EVENT_LABELS[e.event_type] ?? e.event_type}</span>
                  <span className="ml-2 text-label text-ink-3">{formatDate(e.occurred_at)} · {relativeTime(e.occurred_at)}</span>
                </div>
                <div className="mt-0.5 text-label text-ink-2">
                  {e.event_type === 'weighing' && e.payload?.weight_kg && (
                    <span className="tnum">{e.payload.weight_kg} kg{e.payload.adg_since_last ? ` · GDP ${Number(e.payload.adg_since_last).toFixed(2)} kg/d` : ''}</span>
                  )}
                  {(e.event_type === 'treatment' || e.event_type === 'vaccination') && e.payload?.product}
                  {e.event_type === 'pregnancy_diagnosed' && `Ecografía · parto probable ${formatDate(e.payload?.expected_due_date)}`}
                  {e.event_type === 'birth' && 'Alta en el sistema'}
                  {e.event_type === 'purchase' && 'Alta por compra'}
                  {e.event_type === 'transfer' && 'Alta por transferencia'}
                  {e.event_type === 'note' && e.payload?.text}
                  {e.event_type === 'edit' && `Se actualizó: ${(e.payload?.changes ?? []).join(', ')}`}
                  {(e.event_type === 'identifier_added' || e.event_type === 'identifier_retired') && `${e.payload?.type ?? ''} ${e.payload?.value ?? ''}`}
                  {e.event_type === 'identifier_official' && `${e.payload?.value ?? ''} → oficial`}
                </div>
              </div>
            );
          })}
          {!shown.length && <p className="text-body text-ink-3">Sin eventos de ese tipo.</p>}
        </div>
      </Card>

      <div className="col-span-2 space-y-4 max-lg:col-span-3">
        <Card>
          <CardTitle>Curva de crecimiento</CardTitle>
          <WeightChart
            width={440}
            points={(animal.weight_series ?? []).map((w: any) => ({
              label: new Date(w.weighed_at).toLocaleDateString('es-AR', { month: 'short' }),
              value: w.weight_kg,
            }))}
          />
        </Card>
        <Card>
          <CardTitle>Identificadores</CardTitle>
          <IdentifiersManager animalId={animal.id} identifiers={animal.identifiers ?? []} />
        </Card>
        <Card>
          <CardTitle>Registrar pesaje</CardTitle>
          <WeighingForm animalId={animal.id} />
        </Card>
        <Card>
          <CardTitle>Multimedia</CardTitle>
          <PhotoGallery animalId={animal.id} />
        </Card>
      </div>
    </div>
  );
}

function SanidadTab({ treatments, vaccinations, openCases, animalTag }: { treatments: any[]; vaccinations: any[]; openCases: any[]; animalTag?: string }) {
  return (
    <div className="grid grid-cols-2 gap-4 max-md:grid-cols-1">
      <Card>
        <div className="mb-2 flex items-center justify-between">
          <CardTitle>Casos clínicos abiertos</CardTitle>
          <Link href="/sanidad" className="text-label font-medium text-brand hover:underline">Sanidad →</Link>
        </div>
        {openCases.length ? (
          <ul className="space-y-2">
            {openCases.map((c: any) => (
              <li key={c.id} className="flex items-center justify-between rounded-md border border-warning/25 bg-warning/5 px-3 py-2 text-body">
                <span>{c.diagnosis ?? 'Caso clínico'}<span className="ml-2 text-label text-ink-3">{c.severity ?? ''}</span></span>
                <span className="text-label text-ink-3">{c.days_open} días</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="py-2 text-body text-ink-3">Sin casos abiertos.</p>
        )}
      </Card>

      <Card>
        <CardTitle>Vacunaciones</CardTitle>
        {vaccinations.length ? (
          <ul className="mt-2 space-y-1.5">
            {vaccinations.map((v: any) => (
              <li key={v.id} className="flex items-center justify-between text-body">
                <span>{v.product ?? 'Vacuna'}</span>
                <span className={`text-label ${v.overdue ? 'font-medium text-danger' : 'text-ink-3'}`}>
                  {formatDate(v.applied_at)}{v.next_due_date ? ` · próx. ${formatDate(v.next_due_date)}${v.overdue ? ' (vencida)' : ''}` : ''}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="py-2 text-body text-ink-3">Sin vacunaciones registradas.</p>
        )}
      </Card>

      <Card className="col-span-2 max-md:col-span-1">
        <CardTitle>Tratamientos</CardTitle>
        {treatments.length ? (
          <ul className="mt-2 space-y-1.5">
            {treatments.map((t: any) => (
              <li key={t.id} className="flex items-center justify-between text-body">
                <span>{t.product ?? 'Tratamiento'}{t.notes ? <span className="ml-2 text-label text-ink-3">{t.notes}</span> : null}</span>
                <span className={`text-label ${t.withdrawal_active ? 'font-medium text-warning' : 'text-ink-3'}`}>
                  {formatDate(t.applied_at)}
                  {t.withdrawal_active && t.meat_withdrawal_until ? ` · retiro hasta ${formatDate(t.meat_withdrawal_until)}` : ''}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="py-2 text-body text-ink-3">Sin tratamientos registrados.</p>
        )}
      </Card>
    </div>
  );
}

function ReproTab({ status }: { status: any }) {
  if (!status) {
    return <Card><p className="py-4 text-center text-body text-ink-3">Este animal no es un vientre activo (o no hay datos reproductivos).</p></Card>;
  }
  const rows: [string, string | number | null][] = [
    ['Estado', REPRO_LABELS[status.status] ?? status.status],
    ['Días abiertos', status.days_open ?? '—'],
    ['Días postparto', status.days_postpartum ?? '—'],
    ['Días desde servicio', status.days_since_service ?? '—'],
    ['Último servicio', status.last_service ? formatDate(status.last_service) : '—'],
    ['Último parto', status.last_calving ? formatDate(status.last_calving) : '—'],
    ['Parto probable', status.expected_due_date ? `${formatDate(status.expected_due_date)}${status.days_until != null ? ` (${status.days_until} días)` : ''}` : '—'],
    ['Lista para servicio', status.eligible_for_service ? 'Sí' : 'No'],
  ];
  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <CardTitle>Estado reproductivo</CardTitle>
        <Link href="/reproduccion" className="text-label font-medium text-brand hover:underline">Reproducción →</Link>
      </div>
      <dl className="grid grid-cols-2 gap-x-8 gap-y-2.5 max-md:grid-cols-1">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between border-b border-subtle pb-1.5 last:border-0">
            <dt className="text-label text-ink-2">{k}</dt>
            <dd className="tnum text-body font-medium">{v}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

function MovimientosTab({ movements, daysInLot, lotName, paddockName }: { movements: any[]; daysInLot: number | null; lotName?: string; paddockName?: string }) {
  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <CardTitle>Historial de movimientos</CardTitle>
        <span className="text-label text-ink-3">
          <MapPin size={13} className="mr-1 inline" />
          {lotName ?? 'sin lote'}{paddockName ? ` · ${paddockName}` : ''}
          {daysInLot != null ? ` · ${daysInLot} días acá` : ''}
        </span>
      </div>
      {movements.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-body">
            <thead>
              <tr className="h-8 border-b border-subtle text-left text-caption font-medium tracking-[0.06em] text-ink-3 uppercase">
                <th>Fecha</th><th>Tipo</th><th>Origen</th><th>Destino</th><th>Motivo</th><th>Usuario</th>
              </tr>
            </thead>
            <tbody>
              {movements.map((m: any) => (
                <tr key={m.movement_id + m.moved_at} className="h-9 border-b border-subtle last:border-0">
                  <td className="tnum text-ink-2">{formatDate(m.moved_at)}</td>
                  <td>{MOVE_LABEL[m.kind] ?? m.kind}</td>
                  <td className="text-ink-2">{m.from_lot ?? '—'}{m.from_paddock ? ` · ${m.from_paddock}` : ''}</td>
                  <td className="text-ink-2">{m.to_lot ?? '—'}{m.to_paddock ? ` · ${m.to_paddock}` : ''}</td>
                  <td className="text-ink-3">{m.reason ?? '—'}</td>
                  <td className="text-ink-3">{m.actor ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="py-2 text-body text-ink-3">Sin movimientos registrados. Usá «Mover» para cambiar de lote.</p>
      )}
    </Card>
  );
}

function GenealogiaTab({ animal, genealogy, milk, calvings }: { animal: any; genealogy?: any; milk: any; calvings: number }) {
  const g = animal.genealogy;
  const ancestors: any[] = genealogy?.ancestors ?? [];
  const offspring: any[] = genealogy?.offspring ?? animal.offspring ?? [];
  const byRelation = (rel: string) => ancestors.find((a) => a.relation === rel);
  const visualTag = animal.identifiers?.find((i: any) => i.type === 'visual')?.value ?? '—';

  // Nodo del árbol: caravana (link) + relación.
  const Node = ({ node, muted }: { node: any; muted?: boolean }) =>
    node ? (
      <Link href={`/animales/${node.id}`} className={`inline-flex h-7 items-center rounded-md border px-2.5 font-mono text-label font-medium ${muted ? 'border-subtle text-ink-2' : 'border-brand/40 bg-brand-soft/40 text-brand'} hover:border-brand`}>
        {node.tag ?? node.id.slice(0, 6)}
      </Link>
    ) : (
      <span className="inline-flex h-7 items-center rounded-md border border-dashed border-strong px-2.5 text-label text-ink-3">—</span>
    );

  return (
    <div className="space-y-4">
      {/* Árbol de ancestros (hasta abuelos) */}
      <Card>
        <CardTitle>Árbol genealógico</CardTitle>
        <div className="mt-3 flex items-center gap-6 overflow-x-auto pb-1">
          <div className="shrink-0">
            <div className="mb-1 text-caption text-ink-3">Animal</div>
            <span className="inline-flex h-8 items-center rounded-md border border-ink/20 bg-sunken px-3 font-mono text-body font-semibold">{visualTag}</span>
          </div>
          <div className="shrink-0">
            <div className="mb-1 text-caption text-ink-3">Padres</div>
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-1.5"><span className="w-8 text-caption text-ink-3">♀</span> <Node node={byRelation('dam')} /></div>
              <div className="flex items-center gap-1.5"><span className="w-8 text-caption text-ink-3">♂</span> <Node node={byRelation('sire')} /></div>
            </div>
          </div>
          <div className="shrink-0">
            <div className="mb-1 text-caption text-ink-3">Abuelos</div>
            <div className="flex flex-col gap-1.5">
              <Node node={byRelation('dam.dam')} muted /> <Node node={byRelation('dam.sire')} muted />
              <Node node={byRelation('sire.dam')} muted /> <Node node={byRelation('sire.sire')} muted />
            </div>
          </div>
        </div>
        {!g?.dam_id && !g?.sire_id && <p className="mt-2 text-label text-ink-3">Sin padres registrados. Editá el animal para cargar la genealogía.</p>}
      </Card>

      <Card>
        <div className="flex items-center justify-between">
          <CardTitle>Descendencia</CardTitle>
          <span className="text-label text-ink-3">{offspring.length} cría{offspring.length === 1 ? '' : 's'}{calvings ? ` · ${calvings} partos` : ''}</span>
        </div>
        {offspring.length ? (
          <ul className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1.5 max-md:grid-cols-1">
            {offspring.map((o: any) => (
              <li key={o.id} className="flex items-center justify-between border-b border-subtle pb-1.5 text-body">
                <Link href={`/animales/${o.id}`} className="font-mono text-brand hover:underline">{o.tag ?? o.id.slice(0, 6)}</Link>
                <span className="text-label text-ink-3">
                  {o.sex === 'F' ? 'Hembra' : 'Macho'}{o.birth_date ? ` · ${ageFrom(o.birth_date)}` : ''}{o.status && o.status !== 'active' ? ` · ${o.status}` : ''}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="py-2 text-body text-ink-3">Sin crías registradas.</p>
        )}
        {milk && (
          <div className="mt-3 flex items-center gap-2 rounded-md bg-sunken px-3 py-2 text-label text-ink-2">
            <Milk size={14} /> Leche (30 d): {milk.total_liters} L · {milk.avg_liters} L/día prom.
          </div>
        )}
      </Card>
    </div>
  );
}
