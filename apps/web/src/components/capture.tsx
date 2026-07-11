'use client';

import { useState } from 'react';
import { API_URL, authHeaders } from '@/lib/api';
import { Check, X } from 'lucide-react';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';

export function Tabs({ tabs, active, onChange }: { tabs: string[]; active: string; onChange: (t: string) => void }) {
  return (
    <div className="mb-4 flex flex-wrap gap-1 rounded-md bg-sunken p-1">
      {tabs.map((t) => (
        <button
          key={t}
          type="button"
          onClick={() => onChange(t)}
          className={`h-7 flex-1 rounded px-3 text-label font-medium whitespace-nowrap transition-colors ${
            active === t ? 'bg-surface text-ink shadow-[var(--shadow-1)]' : 'text-ink-2 hover:text-ink'
          }`}
        >
          {t}
        </button>
      ))}
    </div>
  );
}

export interface PickedAnimal {
  id: string;
  tag: string;
  name?: string;
  category?: string;
  sex?: string;
  last_weight_kg?: number;
}

/**
 * Selector de animal por caravana (doc diseño §10.2): input → lookup →
 * tarjeta de confirmación. "El error de animal equivocado es el más caro."
 */
export function AnimalPicker({ animal, onSelect }: { animal: PickedAnimal | null; onSelect: (a: PickedAnimal | null) => void }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function lookup() {
    if (!value.trim()) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`${API_URL}/animals/lookup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ identifier: value.trim() }),
      });
      if (!res.ok) throw new Error(`Sin animal con caravana ${value.trim()}`);
      onSelect(await res.json());
      setValue('');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (animal) {
    return (
      <div className="flex items-center gap-3 rounded-md border border-subtle bg-sunken px-3 py-2">
        <span className="font-mono text-subheading font-semibold">{animal.tag}</span>
        <span className="min-w-0 flex-1 truncate text-label text-ink-2">
          {animal.name ? `${animal.name} · ` : ''}
          {animal.category ?? ''}
          {animal.last_weight_kg ? ` · ${Math.round(animal.last_weight_kg)} kg` : ''}
        </span>
        <Check size={14} className="shrink-0 text-success" />
        <button type="button" onClick={() => onSelect(null)} className="shrink-0 text-ink-3 hover:text-ink" aria-label="Quitar animal">
          <X size={14} />
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="flex gap-2">
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), lookup())}
          placeholder="Caravana…"
          controlSize="md"
          className="font-mono"
        />
        <Button type="button" variant="secondary" size="md" onClick={lookup} loading={busy} disabled={!value.trim()} className="shrink-0">
          {busy ? '…' : 'Buscar'}
        </Button>
      </div>
      {error && <p className="mt-1 text-label text-danger">{error}</p>}
    </div>
  );
}

/** Envío genérico con feedback (guardado ✓ / error inline). */
export function useSubmit() {
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [message, setMessage] = useState('');

  async function submit(path: string, body: unknown, okMessage: (res: any) => string) {
    setState('saving');
    setMessage('');
    try {
      const res = await fetch(`${API_URL}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders(), 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.message?.title ?? json?.title ?? `Error ${res.status}`);
      setState('saved');
      setMessage(okMessage(json));
      setTimeout(() => setState('idle'), 4000);
      return json;
    } catch (e: any) {
      setState('error');
      setMessage(e.message);
      return null;
    }
  }
  return { state, message, submit };
}

export function SubmitFeedback({ state, message }: { state: string; message: string }) {
  if (state === 'saved') return <p className="text-label font-medium text-success">✓ {message}</p>;
  if (state === 'error') return <p className="text-label text-danger">{message}</p>;
  return null;
}
