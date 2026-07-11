'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AnimalPicker, PickedAnimal, SubmitFeedback, Tabs, useSubmit } from '@/components/capture';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { Input } from '@/components/Input';
import { Select } from '@/components/Select';

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
          <span className="mb-1 block text-label font-medium text-ink-2">{tab === 'Parto' ? 'Madre *' : tab === 'Destete' ? 'Ternero/a *' : 'Hembra *'}</span>
          <AnimalPicker animal={animal} onSelect={setAnimal} />
        </div>

        <Field label="Fecha" htmlFor="date">
          <Input id="date" name="date" type="date" controlSize="md" defaultValue={new Date().toISOString().slice(0, 10)} />
        </Field>

        {tab === 'Celo' && (
          <Field label="Notas" htmlFor="notes">
            <Input id="notes" name="notes" controlSize="md" placeholder="Intensidad, observador…" />
          </Field>
        )}

        {tab === 'Servicio' && (
          <>
            <div>
              <span className="mb-1 block text-label font-medium text-ink-2">Método</span>
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
              <Field label="Toro" htmlFor="sire_id">
                <Select id="sire_id" name="sire_id" controlSize="md" defaultValue="">
                  <option value="">Sin especificar</option>
                  {bulls.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.tag ?? b.id.slice(0, 8)}
                      {b.name ? ` — ${b.name}` : ''}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </>
        )}

        {tab === 'Diagnóstico' && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Resultado" htmlFor="result" required>
              <Select id="result" name="result" required controlSize="md">
                <option value="pregnant">Preñada</option>
                <option value="empty">Vacía</option>
              </Select>
            </Field>
            <Field label="Método" htmlFor="diag_method">
              <Select id="diag_method" name="diag_method" controlSize="md" defaultValue="ultrasound">
                <option value="ultrasound">Ecografía</option>
                <option value="palpation">Palpación</option>
                <option value="blood">Sangre</option>
              </Select>
            </Field>
          </div>
        )}

        {tab === 'Parto' && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Facilidad (1–5)" htmlFor="ease">
                <Select id="ease" name="ease" controlSize="md" defaultValue="1">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>
                      {n} {n === 1 ? '(sin ayuda)' : n === 5 ? '(cesárea)' : ''}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Vitalidad" htmlFor="vitality">
                <Select id="vitality" name="vitality" controlSize="md" defaultValue="live">
                  <option value="live">Viva</option>
                  <option value="stillborn">Mortinato</option>
                  <option value="died_soon">Murió a las horas</option>
                </Select>
              </Field>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Sexo de la cría" htmlFor="calf_sex" required>
                <Select id="calf_sex" name="calf_sex" required controlSize="md">
                  <option value="F">Hembra</option>
                  <option value="M">Macho</option>
                </Select>
              </Field>
              <Field label="Caravana de la cría" htmlFor="calf_tag">
                <Input id="calf_tag" name="calf_tag" controlSize="md" className="font-mono" placeholder="801" />
              </Field>
              <Field label="Peso al nacer (kg)" htmlFor="calf_weight">
                <Input id="calf_weight" name="calf_weight" type="number" step="0.5" controlSize="md" placeholder="35" />
              </Field>
            </div>
          </>
        )}

        {tab === 'Destete' && (
          <Field label="Peso al destete (kg)" htmlFor="weight">
            <Input id="weight" name="weight" type="number" step="0.5" controlSize="md" placeholder="180" />
          </Field>
        )}

        <SubmitFeedback state={state} message={message} />
        <Button type="submit" size="md" fullWidth loading={state === 'saving'} disabled={!animal}>
          {state === 'saving' ? 'Guardando…' : `Registrar ${tab.toLowerCase()}`}
        </Button>
      </div>
    </form>
  );
}
