'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AnimalPicker, PickedAnimal, SubmitFeedback, Tabs, inputCls, labelCls, useSubmit } from '@/components/capture';

export function ReproCapture({ bulls }: { bulls: any[] }) {
  const router = useRouter();
  const [tab, setTab] = useState('Celo');
  const [animal, setAnimal] = useState<PickedAnimal | null>(null);
  const [method, setMethod] = useState('ai');
  const { state, message, submit } = useSubmit();

  async function handle(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!animal) return;
    const fd = new FormData(e.currentTarget);
    const form = e.currentTarget;
    const date = (fd.get('date') as string) || undefined;
    let res = null;

    if (tab === 'Celo') {
      res = await submit(`/animals/${animal.id}/heats`, { occurred_at: date, notes: fd.get('notes') || undefined }, () => `Celo registrado para ${animal.tag}`);
    } else if (tab === 'Servicio') {
      res = await submit(
        `/animals/${animal.id}/services`,
        { method, sire_id: fd.get('sire_id') || undefined, occurred_at: date },
        () => `Servicio (${method === 'ai' ? 'IA' : 'monta natural'}) registrado para ${animal.tag}`,
      );
    } else if (tab === 'Diagnóstico') {
      res = await submit(
        '/pregnancy-diagnoses',
        { animal_id: animal.id, result: fd.get('result'), method: fd.get('diag_method'), diagnosis_date: date },
        (r) =>
          r.result === 'pregnant'
            ? `${animal.tag} preñada — parto probable ${new Date(r.expected_due_date).toLocaleDateString('es-AR')}`
            : `${animal.tag} vacía${r.previous_pregnancy_lost ? ' (preñez anterior perdida)' : ''}`,
      );
    } else if (tab === 'Parto') {
      res = await submit(
        '/calvings',
        {
          dam_id: animal.id,
          calving_date: date,
          ease: fd.get('ease') ? Number(fd.get('ease')) : undefined,
          offspring: [
            {
              sex: fd.get('calf_sex'),
              tag: fd.get('calf_tag') || undefined,
              birth_weight_kg: fd.get('calf_weight') ? Number(fd.get('calf_weight')) : undefined,
              vitality: fd.get('vitality') ?? 'live',
            },
          ],
        },
        (r) => `Parto de ${animal.tag} registrado — ${r.offspring.length} cría(s) dada(s) de alta`,
      );
    } else {
      res = await submit(
        '/weanings',
        { animal_id: animal.id, weaning_date: date, weight_kg: fd.get('weight') ? Number(fd.get('weight')) : undefined },
        () => `Destete registrado para ${animal.tag}`,
      );
    }
    if (res) {
      form.reset();
      setAnimal(null);
      router.refresh();
    }
  }

  return (
    <form onSubmit={handle}>
      <Tabs tabs={['Celo', 'Servicio', 'Diagnóstico', 'Parto', 'Destete']} active={tab} onChange={setTab} />
      <div className="space-y-3">
        <div>
          <span className={labelCls}>{tab === 'Parto' ? 'Madre *' : tab === 'Destete' ? 'Ternero/a *' : 'Hembra *'}</span>
          <AnimalPicker animal={animal} onSelect={setAnimal} />
        </div>

        <label className="block">
          <span className={labelCls}>Fecha</span>
          <input name="date" type="date" className={inputCls} defaultValue={new Date().toISOString().slice(0, 10)} />
        </label>

        {tab === 'Celo' && (
          <label className="block">
            <span className={labelCls}>Notas</span>
            <input name="notes" className={inputCls} placeholder="Intensidad, observador…" />
          </label>
        )}

        {tab === 'Servicio' && (
          <>
            <div>
              <span className={labelCls}>Método</span>
              <div className="flex gap-2">
                {[
                  ['ai', 'Inseminación (IA)'],
                  ['natural', 'Monta natural'],
                ].map(([v, l]) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setMethod(v)}
                    className={`h-9 flex-1 rounded-md border text-body font-medium ${
                      method === v ? 'border-brand bg-brand-soft text-brand' : 'border-strong text-ink-2 hover:bg-sunken'
                    }`}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>
            {method === 'natural' && (
              <label className="block">
                <span className={labelCls}>Toro</span>
                <select name="sire_id" className={inputCls} defaultValue="">
                  <option value="">Sin especificar</option>
                  {bulls.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.tag ?? b.id.slice(0, 8)}
                      {b.name ? ` — ${b.name}` : ''}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </>
        )}

        {tab === 'Diagnóstico' && (
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className={labelCls}>Resultado *</span>
              <select name="result" required className={inputCls}>
                <option value="pregnant">Preñada</option>
                <option value="empty">Vacía</option>
              </select>
            </label>
            <label className="block">
              <span className={labelCls}>Método</span>
              <select name="diag_method" className={inputCls} defaultValue="ultrasound">
                <option value="ultrasound">Ecografía</option>
                <option value="palpation">Palpación</option>
                <option value="blood">Sangre</option>
              </select>
            </label>
          </div>
        )}

        {tab === 'Parto' && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className={labelCls}>Facilidad (1–5)</span>
                <select name="ease" className={inputCls} defaultValue="1">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>
                      {n} {n === 1 ? '(sin ayuda)' : n === 5 ? '(cesárea)' : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className={labelCls}>Vitalidad</span>
                <select name="vitality" className={inputCls} defaultValue="live">
                  <option value="live">Viva</option>
                  <option value="stillborn">Mortinato</option>
                  <option value="died_soon">Murió a las horas</option>
                </select>
              </label>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <label className="block">
                <span className={labelCls}>Sexo de la cría *</span>
                <select name="calf_sex" required className={inputCls}>
                  <option value="F">Hembra</option>
                  <option value="M">Macho</option>
                </select>
              </label>
              <label className="block">
                <span className={labelCls}>Caravana de la cría</span>
                <input name="calf_tag" className={`${inputCls} font-mono`} placeholder="801" />
              </label>
              <label className="block">
                <span className={labelCls}>Peso al nacer (kg)</span>
                <input name="calf_weight" type="number" step="0.5" className={inputCls} placeholder="35" />
              </label>
            </div>
          </>
        )}

        {tab === 'Destete' && (
          <label className="block">
            <span className={labelCls}>Peso al destete (kg)</span>
            <input name="weight" type="number" step="0.5" className={inputCls} placeholder="180" />
          </label>
        )}

        <SubmitFeedback state={state} message={message} />
        <button
          type="submit"
          disabled={!animal || state === 'saving'}
          className="h-9 w-full rounded-md bg-brand text-body font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {state === 'saving' ? 'Guardando…' : `Registrar ${tab.toLowerCase()}`}
        </button>
      </div>
    </form>
  );
}
