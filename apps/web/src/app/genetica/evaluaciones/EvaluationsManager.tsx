'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { API_URL, authHeaders } from '@/lib/api';
import { Card, CardTitle } from '@/components/ui';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Select } from '@/components/Select';

interface Evaluation {
  id: string;
  animal_id: string;
  source: string | null;
  evaluation_date: string | null;
  traits: Record<string, unknown>;
}
interface Animal {
  id: string;
  tag: string | null;
  name: string | null;
}
interface Trait {
  key: string;
  value: string;
}

export function EvaluationsManager({ evaluations, animals }: { evaluations: Evaluation[]; animals: Animal[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [animalId, setAnimalId] = useState(animals[0]?.id ?? '');
  const [source, setSource] = useState('');
  const [traits, setTraits] = useState<Trait[]>([{ key: '', value: '' }]);

  const setTrait = (i: number, patch: Partial<Trait>) => setTraits((ts) => ts.map((t, idx) => (idx === i ? { ...t, ...patch } : t)));
  const animalLabel = (id: string) => {
    const a = animals.find((x) => x.id === id);
    return a ? a.tag ?? a.name ?? a.id.slice(0, 8) : id.slice(0, 8);
  };

  async function create() {
    if (busy) return;
    if (!animalId) return setError('Elegí un animal.');
    const obj: Record<string, number | string> = {};
    for (const t of traits) {
      if (!t.key.trim()) continue;
      const num = Number(t.value);
      obj[t.key.trim()] = t.value !== '' && Number.isFinite(num) ? num : t.value;
    }
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`${API_URL}/genetics/evaluations`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ animal_id: animalId, source: source || undefined, traits: obj }) });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.title ?? `Error ${res.status}`);
      }
      setSource('');
      setTraits([{ key: '', value: '' }]);
      router.refresh();
    } catch (e: any) {
      setError(e.message ?? 'No se pudo guardar.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid grid-cols-3 gap-4 max-lg:grid-cols-1">
      <Card className="self-start">
        <CardTitle>Nueva evaluación</CardTitle>
        {error && <p role="alert" className="mb-2 text-label text-danger">{error}</p>}
        {animals.length === 0 ? (
          <p className="text-label text-ink-3">Cargá animales primero.</p>
        ) : (
          <div className="space-y-2">
            <Select value={animalId} onChange={(e) => setAnimalId(e.target.value)} aria-label="Animal">
              {animals.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.tag ?? a.name ?? a.id.slice(0, 8)}
                </option>
              ))}
            </Select>
            <Input value={source} onChange={(e) => setSource(e.target.value)} placeholder="Fuente (p.ej. Cabaña / test)" aria-label="Fuente" />
            <div className="space-y-1 border-t border-subtle pt-2">
              {traits.map((t, i) => (
                <div key={i} className="flex gap-1">
                  <Input value={t.key} onChange={(e) => setTrait(i, { key: e.target.value })} placeholder="Rasgo" aria-label={`Rasgo ${i + 1}`} />
                  <Input value={t.value} onChange={(e) => setTrait(i, { value: e.target.value })} placeholder="Valor" aria-label={`Valor ${i + 1}`} />
                </div>
              ))}
              <Button variant="secondary" size="sm" onClick={() => setTraits((ts) => [...ts, { key: '', value: '' }])}>
                + Rasgo
              </Button>
            </div>
            <Button size="sm" fullWidth loading={busy} disabled={busy} onClick={create}>
              Registrar evaluación
            </Button>
          </div>
        )}
      </Card>

      <Card className="col-span-2 self-start max-lg:col-span-3">
        <CardTitle action={<span className="text-label text-ink-3">{evaluations.length}</span>}>Evaluaciones</CardTitle>
        {evaluations.length === 0 ? (
          <p className="py-3 text-center text-label text-ink-3">Sin evaluaciones.</p>
        ) : (
          <ul className="divide-y divide-subtle">
            {evaluations.map((ev) => (
              <li key={ev.id} className="py-2">
                <div className="flex justify-between text-body">
                  <span className="font-medium">{animalLabel(ev.animal_id)}</span>
                  <span className="text-label text-ink-3">{ev.source ?? ev.evaluation_date ?? ''}</span>
                </div>
                <div className="text-label text-ink-3">
                  {Object.entries(ev.traits ?? {})
                    .map(([k, v]) => `${k}: ${v}`)
                    .join(' · ') || '—'}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
