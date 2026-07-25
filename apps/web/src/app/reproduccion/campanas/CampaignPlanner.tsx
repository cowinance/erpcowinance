'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { API_URL, authHeaders } from '@/lib/api';
import { Card, CardTitle, EmptyState } from '@/components/ui';
import { Button } from '@/components/Button';
import { Select } from '@/components/Select';

interface Row {
  animal_id: string;
  animal_tag: string | null;
  eligibility: 'pending' | 'eligible' | 'not_eligible';
  plan_id: string | null;
  method: 'ai' | 'embryo_transfer' | null;
  straw_id: string | null;
  status: 'planned' | 'served' | 'released' | null;
  origin_label: string | null;
  location_label: string;
}
interface Summary {
  total: number;
  pending_review: number;
  eligible: number;
  not_eligible: number;
  planned: number;
  served: number;
  without_straw: number;
}
interface Origin {
  id: string;
  kind: 'semen' | 'embryo';
  label: string;
  straws: { id: string; label: string }[];
}
interface Outcome {
  served: number;
  pregnant: number;
  empty: number;
  doubtful: number;
  pending_diagnosis: number;
  conception_rate: number | null;
  closed: boolean;
}
interface SireRate {
  sire_key: string;
  sire_label: string;
  services: number;
  pregnant: number;
  empty: number;
  pending: number;
  conception_rate: number | null;
  reliable: boolean;
}
interface OutcomeRow {
  animal_id: string;
  animal_tag: string | null;
  served: boolean;
  sire_label: string | null;
  diagnosis: 'pregnant' | 'empty' | 'doubtful' | null;
}
interface PickingLine {
  tank_code: string | null;
  canister_code: string | null;
  canister_color: string | null;
  goblet_code: string | null;
  straws: { straw_id: string; animal_tag: string | null; origin_label: string }[];
}

const REVISION: Record<Row['eligibility'], string> = {
  pending: 'Sin revisar',
  eligible: 'Apta',
  not_eligible: 'No apta',
};

/**
 * Planificador de la campaña (GT-3).
 *
 * El orden de la pantalla sigue el orden del trabajo: primero la revisión (¿hizo cuerpo lúteo?),
 * después qué se le pone a cada una. Un vientre que salió «no apta» queda visiblemente fuera y no
 * se puede planificar — planificarlo apartaría una pajuela que otra vaca podría usar.
 */
export function CampaignPlanner({
  assignmentId,
  summary,
  rows,
  origins,
  picking,
  outcome,
  bySire,
  outcomeRows,
}: {
  assignmentId: string;
  summary: Summary;
  rows: Row[];
  origins: Origin[];
  picking: PickingLine[];
  outcome: Outcome;
  bySire: SireRate[];
  outcomeRows: OutcomeRow[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [origen, setOrigen] = useState<Record<string, string>>({});
  const [pajuela, setPajuela] = useState<Record<string, string>>({});

  async function call(method: string, path: string, data?: any) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`${API_URL}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: data ? JSON.stringify(data) : undefined,
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.title ?? `Error ${res.status}`);
      }
      router.refresh();
    } catch (e: any) {
      setError(e.message ?? 'No se pudo guardar.');
    } finally {
      setBusy(false);
    }
  }

  function guardarPlan(animalId: string) {
    const originId = origen[animalId];
    const o = origins.find((x) => x.id === originId);
    if (!o) return;
    call('POST', `/reproduction/campaigns/${assignmentId}/plan`, {
      animal_id: animalId,
      method: o.kind === 'semen' ? 'ai' : 'embryo_transfer',
      semen_batch_id: o.kind === 'semen' ? o.id : undefined,
      embryo_id: o.kind === 'embryo' ? o.id : undefined,
      straw_id: pajuela[animalId] || undefined,
    });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>Estado de la campaña</CardTitle>
        <div className="grid grid-cols-6 gap-3 max-md:grid-cols-3">
          {[
            ['Vientres', summary.total, ''],
            ['Sin revisar', summary.pending_review, summary.pending_review > 0 ? 'text-warning' : ''],
            ['Aptas', summary.eligible, ''],
            ['No aptas', summary.not_eligible, ''],
            ['Planificadas', summary.planned, ''],
            ['Servidas', summary.served, ''],
          ].map(([label, valor, tono]) => (
            <div key={label as string}>
              <div className="text-caption text-ink-3">{label}</div>
              <div className={`tnum text-xl font-semibold ${tono}`}>{valor as number}</div>
            </div>
          ))}
        </div>
        {/* El único número accionable ANTES de la jornada: una vaca planificada sin pajuela
            reservada llega a la manga sin nada con qué servirla, y eso se arregla en la oficina. */}
        {summary.without_straw > 0 && (
          <p role="alert" className="mt-3 rounded-md bg-warning/10 px-3 py-2 text-label text-warning">
            {summary.without_straw} {summary.without_straw === 1 ? 'vientre planificado' : 'vientres planificados'} sin pajuela
            reservada. Si llegan así a la jornada, no hay con qué servirlos.
          </p>
        )}
        {error && (
          <p role="alert" className="mt-2 text-label text-danger">
            {error}
          </p>
        )}
      </Card>

      <Card>
        <CardTitle>
          <span>Plan por vientre</span>
          <span className="text-caption font-normal text-ink-3">Primero la revisión, después qué se le pone</span>
        </CardTitle>
        <div className="overflow-x-auto">
          <table className="w-full text-body">
            <thead className="text-left text-caption text-ink-3">
              <tr className="border-b border-subtle">
                <th className="py-1.5">Vientre</th>
                <th className="py-1.5">Revisión</th>
                <th className="py-1.5">Qué se le pone</th>
                <th className="py-1.5">Pajuela</th>
                <th className="py-1.5 text-right">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-subtle">
              {rows.map((r) => {
                const descartada = r.eligibility === 'not_eligible';
                const servida = r.status === 'served';
                // Un plan «released» es uno que la revisión soltó: la pajuela YA volvió al termo.
                // Seguir mostrándolo como plan vigente —con su posición y su botón de sacar— haría
                // creer que hay una pajuela apartada que en realidad está libre para otra vaca.
                const soltada = r.status === 'released';
                const planVigente = !!r.status && !soltada;
                const seleccion = origen[r.animal_id] ?? '';
                const o = origins.find((x) => x.id === seleccion);
                return (
                  <tr key={r.animal_id} className={descartada ? 'text-ink-3' : ''}>
                    <td className="py-1.5 font-medium">{r.animal_tag ?? r.animal_id.slice(0, 8)}</td>
                    <td className="py-1.5">
                      <Select
                        value={r.eligibility}
                        onChange={(e) =>
                          call('PUT', `/reproduction/campaigns/${assignmentId}/animals/${r.animal_id}/eligibility`, {
                            eligibility: e.target.value,
                          })
                        }
                        controlSize="sm"
                        aria-label={`Revisión de ${r.animal_tag ?? r.animal_id.slice(0, 8)}`}
                        className="w-32"
                        disabled={servida}
                      >
                        {(['pending', 'eligible', 'not_eligible'] as const).map((k) => (
                          <option key={k} value={k}>
                            {REVISION[k]}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td className="py-1.5">
                      {planVigente ? (
                        <span>
                          {r.origin_label}
                          {servida ? <span className="ml-1 text-caption text-ink-3">· servida</span> : null}
                        </span>
                      ) : descartada ? (
                        <span className="text-caption">queda fuera de la jornada</span>
                      ) : (
                        <Select
                          value={seleccion}
                          onChange={(e) => setOrigen({ ...origen, [r.animal_id]: e.target.value })}
                          controlSize="sm"
                          aria-label={`Origen para ${r.animal_tag ?? r.animal_id.slice(0, 8)}`}
                          className="w-52"
                        >
                          <option value="">Elegí semen o embrión…</option>
                          {origins.map((x) => (
                            <option key={x.id} value={x.id}>
                              {x.label}
                            </option>
                          ))}
                        </Select>
                      )}
                    </td>
                    <td className="py-1.5">
                      {soltada ? (
                        <span className="text-caption">pajuela devuelta al termo</span>
                      ) : r.straw_id && planVigente ? (
                        <span className="text-caption">{r.location_label || 'reservada, sin ubicar'}</span>
                      ) : planVigente ? (
                        <span className="text-caption text-warning">sin reservar</span>
                      ) : o ? (
                        <Select
                          value={pajuela[r.animal_id] ?? ''}
                          onChange={(e) => setPajuela({ ...pajuela, [r.animal_id]: e.target.value })}
                          controlSize="sm"
                          aria-label={`Pajuela para ${r.animal_tag ?? r.animal_id.slice(0, 8)}`}
                          className="w-52"
                        >
                          <option value="">Sin reservar todavía</option>
                          {o.straws.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.label}
                            </option>
                          ))}
                        </Select>
                      ) : (
                        <span className="text-caption text-ink-3">—</span>
                      )}
                    </td>
                    <td className="py-1.5 text-right">
                      {servida || soltada ? null : planVigente ? (
                        <button
                          onClick={() => call('DELETE', `/reproduction/campaigns/${assignmentId}/animals/${r.animal_id}/plan`)}
                          className="h-7 rounded-md border border-strong bg-surface px-2 text-label hover:bg-brand-soft"
                        >
                          Sacar del plan
                        </button>
                      ) : (
                        <Button size="sm" loading={busy} disabled={descartada || !seleccion} onClick={() => guardarPlan(r.animal_id)}>
                          Asignar
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <CardTitle>
          <span>Lista de retiro</span>
          <span className="text-caption font-normal text-ink-3">Un viaje por gobelete</span>
        </CardTitle>
        {picking.length === 0 ? (
          <EmptyState
            title="Todavía no hay nada que retirar"
            body="Aparece cuando hay vientres aptos, planificados y con su pajuela reservada."
          />
        ) : (
          <ul className="space-y-2">
            {picking.map((l, i) => (
              <li key={i} className="rounded-md border border-subtle p-3">
                <div className="text-body font-medium">
                  {[l.tank_code, l.canister_color ? `${l.canister_color} ${l.canister_code}` : l.canister_code, l.goblet_code ? `gob. ${l.goblet_code}` : null]
                    .filter(Boolean)
                    .join(' · ') || 'Sin ubicación'}
                  <span className="ml-2 font-normal text-ink-3">
                    {l.straws.length} {l.straws.length === 1 ? 'pajuela' : 'pajuelas'}
                  </span>
                </div>
                <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-caption text-ink-2">
                  {l.straws.map((s) => (
                    <li key={s.straw_id}>
                      {s.animal_tag ?? '—'} → {s.origin_label}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {outcome.served > 0 && (
        <Card>
          <CardTitle>
            <span>Resultado de la campaña</span>
            <span className="text-caption font-normal text-ink-3">
              {outcome.closed ? 'Cerrada' : `${outcome.pending_diagnosis + outcome.doubtful} sin confirmar`}
            </span>
          </CardTitle>

          <div className="grid grid-cols-5 gap-3 max-md:grid-cols-3">
            {[
              ['Servidas', outcome.served, ''],
              ['Preñadas', outcome.pregnant, 'text-success'],
              ['Vacías', outcome.empty, ''],
              ['Dudosas', outcome.doubtful, outcome.doubtful > 0 ? 'text-warning' : ''],
              [
                'Preñez',
                outcome.conception_rate === null ? '—' : `${outcome.conception_rate}%`,
                outcome.conception_rate === null ? 'text-ink-3' : '',
              ],
            ].map(([label, valor, tono]) => (
              <div key={label as string}>
                <div className="text-caption text-ink-3">{label}</div>
                <div className={`tnum text-xl font-semibold ${tono}`}>{valor as string | number}</div>
              </div>
            ))}
          </div>

          {/* La tasa se calcula sobre lo DIAGNOSTICADO, no sobre lo servido: dividir por las
              servidas daría un porcentaje que arranca en cero y sube a medida que se ecografía, y
              alguien sacaría conclusiones sobre un toro que todavía no tuvo oportunidad de fallar. */}
          <p className="mt-2 text-caption text-ink-3">
            {outcome.conception_rate === null
              ? 'La preñez aparece cuando haya al menos un diagnóstico cargado.'
              : `Sobre ${outcome.pregnant + outcome.empty} diagnosticadas de ${outcome.served} servidas.`}
          </p>

          {bySire.length > 0 && (
            <div className="mt-4">
              <div className="mb-2 text-label font-medium">Por toro</div>
              <div className="overflow-x-auto">
                <table className="w-full text-body">
                  <thead className="text-left text-caption text-ink-3">
                    <tr className="border-b border-subtle">
                      <th className="py-1.5">Toro</th>
                      <th className="py-1.5 text-right">Servicios</th>
                      <th className="py-1.5 text-right">Preñadas</th>
                      <th className="py-1.5 text-right">Preñez</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-subtle">
                    {bySire.map((t) => (
                      <tr key={t.sire_key}>
                        <td className="py-1.5">{t.sire_label}</td>
                        <td className="tnum py-1.5 text-right">{t.services}</td>
                        <td className="tnum py-1.5 text-right">{t.pregnant}</td>
                        <td className="tnum py-1.5 text-right">
                          {t.conception_rate === null ? '—' : `${t.conception_rate}%`}
                          {/* Con pocos servicios, dos tasas se diferencian en UN animal: el dato se
                              muestra igual, pero marcado, para no invitar a comparar lo incomparable. */}
                          {t.conception_rate !== null && !t.reliable && (
                            <span className="ml-1 text-caption font-normal text-ink-3" title="Pocos servicios para comparar">
                              (pocos datos)
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {outcome.pending_diagnosis > 0 && (
            <div className="mt-4">
              <div className="mb-2 text-label font-medium">Falta ecografiar</div>
              <ul className="flex flex-wrap gap-1.5">
                {outcomeRows
                  .filter((r) => r.served && r.diagnosis === null)
                  .map((r) => (
                    <li key={r.animal_id} className="rounded-md bg-sunken px-2 py-1 text-caption">
                      {r.animal_tag ?? r.animal_id.slice(0, 8)}
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
