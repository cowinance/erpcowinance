'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { API_URL, authHeaders, apiErrorTitle } from '@/lib/api';
import { Check } from 'lucide-react';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { Input } from '@/components/Input';

export function WeighingForm({ animalId }: { animalId: string }) {
  const router = useRouter();
  const [kg, setKg] = useState('');
  const [cc, setCc] = useState('');
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState('saving');
    setError('');
    try {
      const res = await fetch(`${API_URL}/animals/${animalId}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders(), 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({
          type: 'weighing',
          weight_kg: Number(kg),
          body_condition: cc ? Number(cc) : undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(apiErrorTitle(body, `Error ${res.status}`));
      }
      setState('saved');
      setKg('');
      setCc('');
      router.refresh();
      setTimeout(() => setState('idle'), 2500);
    } catch (err: any) {
      setState('error');
      setError(err.message);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Peso (kg)" htmlFor="weight_kg">
          <Input
            id="weight_kg"
            type="number"
            required
            min={1}
            step="0.5"
            value={kg}
            onChange={(e) => setKg(e.target.value)}
            controlSize="md"
            className="tnum"
            placeholder="412"
          />
        </Field>
        <Field label="Cond. corporal (1–5)" htmlFor="body_condition">
          <Input
            id="body_condition"
            type="number"
            min={1}
            max={5}
            step="0.5"
            value={cc}
            onChange={(e) => setCc(e.target.value)}
            controlSize="md"
            className="tnum"
            placeholder="3.5"
          />
        </Field>
      </div>
      {state === 'error' && <p className="text-label text-danger">{error}</p>}
      <Button type="submit" size="md" fullWidth loading={state === 'saving'} disabled={!kg} className="gap-1.5">
        {state === 'saved' ? (
          <>
            <Check size={15} aria-hidden="true" /> Guardado
          </>
        ) : state === 'saving' ? (
          'Guardando…'
        ) : (
          'Guardar pesaje'
        )}
      </Button>
    </form>
  );
}
