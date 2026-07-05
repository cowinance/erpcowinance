import Link from 'next/link';
import { notFound } from 'next/navigation';
import { apiSafe } from '@/lib/api';
import { Card, CardTitle, StatusBadge, TagMono } from '@/components/ui';
import { WeightChart } from '@/components/WeightChart';
import { ageFrom, EVENT_LABELS, formatDate, formatKg, relativeTime, STATUS_LABELS } from '@/lib/format';
import { WeighingForm } from './WeighingForm';
import { ArrowLeft, Baby, Clock, Heart, Scale, Stethoscope, Syringe, StickyNote } from 'lucide-react';

const EVENT_ICON: Record<string, any> = {
  birth: Baby,
  weighing: Scale,
  treatment: Stethoscope,
  vaccination: Syringe,
  pregnancy_diagnosed: Heart,
  note: StickyNote,
};

export default async function AnimalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [animal, timeline] = await Promise.all([
    apiSafe<any>(`/animals/${id}`),
    apiSafe<any[]>(`/animals/${id}/timeline`),
  ]);
  if (!animal) notFound();

  const visual = animal.identifiers?.find((i: any) => i.type === 'visual');
  const rfid = animal.identifiers?.find((i: any) => i.type === 'rfid');
  const lw = animal.last_weighing;

  return (
    <div>
      <Link href="/animales" className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-ink-2 hover:text-ink">
        <ArrowLeft size={14} /> Animales
      </Link>

      {/* Cabecera de identidad (doc diseño §12.2) */}
      <div className="mb-5 flex items-start justify-between gap-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-mono text-[28px] leading-9 font-semibold tracking-wide">{visual?.value ?? '—'}</h1>
            <StatusBadge status={animal.status} label={STATUS_LABELS[animal.status] ?? animal.status} />
            {animal.active_withdrawal && (
              <span className="inline-flex items-center gap-1 rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-warning">
                <Clock size={11} /> Retiro hasta {formatDate(animal.active_withdrawal.meat_until)}
              </span>
            )}
          </div>
          <p className="mt-1 text-[13px] text-ink-2">
            {animal.name ? `${animal.name} · ` : ''}
            {animal.category} · {animal.breeds?.map((b: any) => b.name).join(' × ') || 'sin raza'} ·{' '}
            {ageFrom(animal.birth_date)} · {animal.lot_name ?? 'sin lote'} · {animal.paddock_name ?? 'sin potrero'}
          </p>
          <p className="mt-0.5 text-[12px] text-ink-3">
            {rfid && (
              <>
                RFID <TagMono>{rfid.value}</TagMono>
              </>
            )}
            {animal.genealogy?.dam_id && (
              <>
                {rfid && ' · '}Madre{' '}
                <Link href={`/animales/${animal.genealogy.dam_id}`} className="font-mono text-brand hover:underline">
                  {animal.genealogy.dam_tag ?? '—'}
                </Link>
              </>
            )}
            {animal.genealogy?.sire_id && (
              <>
                {' '}· Padre{' '}
                <Link href={`/animales/${animal.genealogy.sire_id}`} className="font-mono text-brand hover:underline">
                  {animal.genealogy.sire_tag ?? '—'}
                </Link>
              </>
            )}
            {(animal.offspring ?? []).length > 0 && (
              <>
                {' '}· Crías:{' '}
                {animal.offspring.map((o: any, i: number) => (
                  <span key={o.id}>
                    {i > 0 && ', '}
                    <Link href={`/animales/${o.id}`} className="font-mono text-brand hover:underline">
                      {o.tag ?? o.id.slice(0, 6)}
                    </Link>
                  </span>
                ))}
              </>
            )}
          </p>
        </div>
      </div>

      {/* Vitales */}
      <div className="mb-4 grid grid-cols-4 gap-4 max-md:grid-cols-2">
        <Card>
          <div className="text-[12px] text-ink-2">Último peso</div>
          <div className="tnum mt-1 text-[26px] font-semibold">{formatKg(lw?.weight_kg)}</div>
          <div className="mt-0.5 text-[12px] text-ink-3">
            {lw ? `${relativeTime(lw.weighed_at)}${lw.adg ? ` · GDP ${lw.adg.toFixed(2)} kg/d` : ''}` : 'sin pesajes'}
          </div>
        </Card>
        <Card>
          <div className="text-[12px] text-ink-2">Condición corporal</div>
          <div className="tnum mt-1 text-[26px] font-semibold">{lw?.body_condition ?? '—'}</div>
          <div className="mt-0.5 text-[12px] text-ink-3">escala 1–5</div>
        </Card>
        <Card>
          <div className="text-[12px] text-ink-2">Estado reproductivo</div>
          <div className="mt-1 text-[26px] font-semibold">
            {animal.open_pregnancy ? 'Preñada' : animal.sex === 'F' ? 'Vacía' : '—'}
          </div>
          <div className="mt-0.5 text-[12px] text-ink-3">
            {animal.open_pregnancy ? `parto probable ${formatDate(animal.open_pregnancy.expected_due_date)}` : animal.sex === 'F' ? 'sin preñez abierta' : 'macho'}
          </div>
        </Card>
        <Card>
          <div className="text-[12px] text-ink-2">Eventos registrados</div>
          <div className="tnum mt-1 text-[26px] font-semibold">{animal.event_count}</div>
          <div className="mt-0.5 text-[12px] text-ink-3">historial completo desde el alta</div>
        </Card>
      </div>

      <div className="grid grid-cols-5 gap-4 max-lg:grid-cols-1">
        {/* Línea de tiempo (la promesa central del producto) */}
        <Card className="col-span-3">
          <CardTitle>Línea de tiempo</CardTitle>
          <div className="relative ml-2 space-y-4 border-l border-subtle pl-5">
            {(timeline ?? []).map((e: any) => {
              const Icon = EVENT_ICON[e.event_type] ?? StickyNote;
              return (
                <div key={e.id} className="relative">
                  <div className="absolute top-0.5 -left-[27.5px] flex size-5 items-center justify-center rounded-full border border-subtle bg-surface">
                    <Icon size={11} strokeWidth={2} className="text-ink-2" />
                  </div>
                  <div className="text-[13px]">
                    <span className="font-medium">{EVENT_LABELS[e.event_type] ?? e.event_type}</span>
                    <span className="ml-2 text-[12px] text-ink-3">
                      {formatDate(e.occurred_at)} · {relativeTime(e.occurred_at)}
                    </span>
                  </div>
                  <div className="mt-0.5 text-[12px] text-ink-2">
                    {e.event_type === 'weighing' && e.payload?.weight_kg && (
                      <span className="tnum">
                        {e.payload.weight_kg} kg
                        {e.payload.adg_since_last ? ` · GDP ${Number(e.payload.adg_since_last).toFixed(2)} kg/d` : ''}
                      </span>
                    )}
                    {(e.event_type === 'treatment' || e.event_type === 'vaccination') && e.payload?.product}
                    {e.event_type === 'pregnancy_diagnosed' &&
                      `Ecografía · parto probable ${formatDate(e.payload?.expected_due_date)}`}
                    {e.event_type === 'birth' && 'Alta en el sistema'}
                    {e.event_type === 'note' && e.payload?.text}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        <div className="col-span-2 space-y-4 max-lg:col-span-3">
          {/* Curva de peso */}
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

          {/* Captura rápida de pesaje */}
          <Card>
            <CardTitle>Registrar pesaje</CardTitle>
            <WeighingForm animalId={animal.id} />
          </Card>
        </div>
      </div>
    </div>
  );
}
