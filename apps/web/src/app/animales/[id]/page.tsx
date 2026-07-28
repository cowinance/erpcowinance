import Link from 'next/link';
import { notFound } from 'next/navigation';
import { apiSafe } from '@/lib/server-api';
import { Card, StatusBadge, TagMono } from '@/components/ui';
import { ageFrom, formatDate, formatKg, relativeTime, STATUS_LABELS } from '@/lib/format';
import { MoveAction } from './MoveAction';
import { EditAnimalButton } from './EditAnimalDialog';
import { LifecycleAction } from './LifecycleAction';
import { AnimalTabs } from './AnimalTabs';
import { fileUrl } from '@/lib/api';
import { ArrowLeft, Clock } from 'lucide-react';

const REPRO_LABELS: Record<string, string> = {
  pregnant: 'Preñada', due_soon: 'Próxima a parir', served: 'Servida', diagnosis_pending: 'Diag. pendiente',
  in_protocol: 'En protocolo', aborted: 'Aborto reciente', postpartum_rest: 'Descanso postparto',
  ready_for_review: 'Lista revisar', ready_for_service: 'Lista servicio', repeat_breeder: 'Repetidora',
  open: 'Vacía', empty: 'Vacía', culled: 'Descartada',
};

export default async function AnimalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [animal, timeline, lots, categories, overview, reproStatus, catalogs, genealogy] = await Promise.all([
    apiSafe<any>(`/animals/${id}`),
    apiSafe<any[]>(`/animals/${id}/timeline`),
    apiSafe<any[]>('/lots'),
    apiSafe<any[]>('/catalogs/categories'),
    apiSafe<any>(`/animals/${id}/overview`),
    apiSafe<any>(`/reproduction/animals/${id}/status`),
    apiSafe<any>('/config/catalogs'),
    apiSafe<any>(`/animals/${id}/genealogy`),
  ]);
  if (!animal) notFound();

  const visual = animal.identifiers?.find((i: any) => i.type === 'visual');
  const rfid = animal.identifiers?.find((i: any) => i.type === 'rfid');
  const lw = animal.last_weighing;

  return (
    <div>
      <Link href="/animales" className="mb-4 inline-flex items-center gap-1.5 text-body text-ink-2 hover:text-ink">
        <ArrowLeft size={14} /> Animales
      </Link>

      {/* Cabecera de identidad (doc diseño §12.2) — foto principal + identidad */}
      <div className="mb-5 flex items-start justify-between gap-6">
        <div className="flex items-start gap-4">
          {fileUrl(animal.photo) ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={fileUrl(animal.photo)!}
              alt={`Foto de ${visual?.value ?? 'animal'}`}
              className="size-20 shrink-0 rounded-lg border border-subtle object-cover"
            />
          ) : (
            <div className="flex size-20 shrink-0 items-center justify-center rounded-lg border border-dashed border-strong bg-sunken text-compat-10 text-ink-3">
              Sin foto
            </div>
          )}
          <div>
          <div className="flex items-center gap-3">
            <h1 className="font-mono text-compat-28 leading-9 font-semibold tracking-wide">{visual?.value ?? '—'}</h1>
            <StatusBadge status={animal.status} label={STATUS_LABELS[animal.status] ?? animal.status} />
            {animal.active_withdrawal && (
              <span className="inline-flex items-center gap-1 rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-caption font-medium text-warning">
                <Clock size={11} /> Retiro hasta {formatDate(animal.active_withdrawal.meat_until)}
              </span>
            )}
          </div>
          <p className="mt-1 text-body text-ink-2">
            {animal.name ? `${animal.name} · ` : ''}
            {animal.category} · {animal.breeds?.map((b: any) => b.name).join(' × ') || 'sin raza'} ·{' '}
            {ageFrom(animal.birth_date)} · {animal.lot_name ?? 'sin lote'} · {animal.paddock_name ?? 'sin potrero'}
          </p>
          <p className="mt-0.5 text-label text-ink-3">
            {rfid && (
              <>
                RFID <TagMono>{rfid.value}</TagMono>
              </>
            )}
            {animal.genealogy?.dam_id && (
              <>
                {/* «Madre genética» solo cuando hay receptora: en el 99% de los animales decir
                    «genética» sería ruido, y en una transferencia decir «madre» a secas sería
                    ambiguo justo donde hay dos. */}
                {rfid && ' · '}{animal.genealogy?.recipient_dam_id ? 'Madre genética' : 'Madre'}{' '}
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
            {animal.genealogy?.recipient_dam_id && (
              <>
                {' '}· Vientre{' '}
                <Link href={`/animales/${animal.genealogy.recipient_dam_id}`} className="font-mono text-brand hover:underline">
                  {animal.genealogy.recipient_tag ?? '—'}
                </Link>
                <span className="ml-1 rounded border border-subtle px-1 text-caption text-ink-3">transferencia</span>
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
        <div className="flex shrink-0 items-center gap-2">
          <EditAnimalButton animal={animal} categories={categories ?? []} breeds={catalogs?.breeds ?? []} />
          <MoveAction animalId={id} lots={lots ?? []} />
          <LifecycleAction animalId={id} active={animal.status === 'active'} />
        </div>
      </div>

      {/* Vitales */}
      <div className="mb-4 grid grid-cols-4 gap-4 max-md:grid-cols-2">
        <Card>
          <div className="text-label text-ink-2">Último peso</div>
          <div className="tnum mt-1 text-compat-26 font-semibold">{formatKg(lw?.weight_kg)}</div>
          <div className="mt-0.5 text-label text-ink-3">
            {lw ? `${relativeTime(lw.weighed_at)}${lw.adg ? ` · GDP ${lw.adg.toFixed(2)} kg/d` : ''}` : 'sin pesajes'}
          </div>
        </Card>
        <Card>
          <div className="text-label text-ink-2">Condición corporal</div>
          <div className="tnum mt-1 text-compat-26 font-semibold">{lw?.body_condition ?? '—'}</div>
          <div className="mt-0.5 text-label text-ink-3">escala 1–5</div>
        </Card>
        <Card>
          <div className="text-label text-ink-2">Estado reproductivo</div>
          <div className="mt-1 text-compat-26 font-semibold">
            {reproStatus ? REPRO_LABELS[reproStatus.status] ?? reproStatus.status : animal.sex === 'F' ? 'Vacía' : '—'}
          </div>
          <div className="mt-0.5 text-label text-ink-3">
            {reproStatus?.expected_due_date
              ? `parto probable ${formatDate(reproStatus.expected_due_date)}`
              : reproStatus?.days_open != null
                ? `${reproStatus.days_open} días abierta`
                : animal.sex === 'F'
                  ? 'sin preñez abierta'
                  : 'macho'}
          </div>
        </Card>
        <Card>
          <div className="text-label text-ink-2">Eventos registrados</div>
          <div className="tnum mt-1 text-compat-26 font-semibold">{animal.event_count}</div>
          <div className="mt-0.5 text-label text-ink-3">historial completo desde el alta</div>
        </Card>
      </div>

      {/* Ficha 360: pestañas que componen las secciones (A360 E3) */}
      <AnimalTabs animal={animal} timeline={timeline ?? []} overview={overview} reproStatus={reproStatus} genealogy={genealogy} />
    </div>
  );
}
