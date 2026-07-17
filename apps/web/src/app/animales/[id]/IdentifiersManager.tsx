'use client';

/**
 * Gestión de identificadores (A360 E4): múltiples tipos (visual/RFID/tatuaje/bolo/marca/
 * biométrico/oficial), marcar oficial (único), retirar (queda en historial). Escribe con
 * POST /animals/:id/identifiers[/:idf/retire|/make-official]. Muestra activos + retirados.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { BadgeCheck, Plus, Star, X } from 'lucide-react';
import { API_URL, authHeaders } from '@/lib/api';
import { Button } from '@/components/Button';

const TYPE_LABELS: Record<string, string> = {
  visual: 'Visual', rfid: 'RFID', tattoo: 'Tatuaje', bolus: 'Bolo', brand: 'Marca', biometric: 'Biométrico', official: 'Oficial',
};

export function IdentifiersManager({ animalId, identifiers }: { animalId: string; identifiers: any[] }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [type, setType] = useState('rfid');
  const [value, setValue] = useState('');
  const [official, setOfficial] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const active = (identifiers ?? []).filter((i) => i.active);
  const retired = (identifiers ?? []).filter((i) => !i.active);

  async function call(url: string, body?: any) {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`${API_URL}${url}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: body ? JSON.stringify(body) : undefined,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message?.title ?? json?.title ?? `Error ${res.status}`);
      setValue('');
      setAdding(false);
      router.refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <ul className="space-y-1.5">
        {active.map((i) => (
          <li key={i.id} className="flex items-center gap-2 text-body">
            <span className="w-16 shrink-0 text-label text-ink-3">{TYPE_LABELS[i.type] ?? i.type}</span>
            <span className="font-mono">{i.value}</span>
            {i.is_official && (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-brand-soft px-1.5 py-0.5 text-caption font-medium text-brand">
                <BadgeCheck size={11} /> oficial
              </span>
            )}
            <span className="ml-auto flex items-center gap-1.5">
              {!i.is_official && (
                <button onClick={() => call(`/animals/${animalId}/identifiers/${i.id}/make-official`)} disabled={busy} title="Marcar oficial" className="text-ink-3 hover:text-brand">
                  <Star size={13} />
                </button>
              )}
              <button onClick={() => call(`/animals/${animalId}/identifiers/${i.id}/retire`)} disabled={busy} title="Retirar" className="text-ink-3 hover:text-danger">
                <X size={13} />
              </button>
            </span>
          </li>
        ))}
        {!active.length && <li className="text-body text-ink-3">Sin identificadores activos.</li>}
      </ul>

      {retired.length > 0 && (
        <div className="mt-2 border-t border-subtle pt-2">
          <p className="mb-1 text-caption text-ink-3">Retirados</p>
          {retired.map((i) => (
            <div key={i.id} className="flex items-center gap-2 text-label text-ink-3">
              <span className="w-16 shrink-0">{TYPE_LABELS[i.type] ?? i.type}</span>
              <span className="font-mono line-through">{i.value}</span>
              {i.retired_at && <span className="ml-auto">{String(i.retired_at).slice(0, 10)}</span>}
            </div>
          ))}
        </div>
      )}

      {adding ? (
        <div className="mt-3 space-y-2 border-t border-subtle pt-3">
          <div className="flex gap-2">
            <select value={type} onChange={(e) => setType(e.target.value)} className="h-8 rounded-md border border-strong bg-surface px-2 text-body outline-none focus:ring-2 focus:ring-brand">
              {Object.entries(TYPE_LABELS).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
            <input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="Valor…"
              className="h-8 flex-1 rounded-md border border-strong bg-surface px-2 font-mono text-body outline-none focus:ring-2 focus:ring-brand"
            />
          </div>
          <label className="flex items-center gap-2 text-label text-ink-2">
            <input type="checkbox" checked={official} onChange={(e) => setOfficial(e.target.checked)} className="size-4 accent-brand" /> Marcar como oficial
          </label>
          {error && <p className="text-label text-danger">{error}</p>}
          <div className="flex gap-2">
            <Button size="sm" loading={busy} disabled={!value.trim()} onClick={() => call(`/animals/${animalId}/identifiers`, { type, value, is_official: official })}>
              Agregar
            </Button>
            <Button size="sm" variant="secondary" onClick={() => { setAdding(false); setError(''); }}>Cancelar</Button>
          </div>
        </div>
      ) : (
        <button onClick={() => setAdding(true)} className="mt-3 inline-flex items-center gap-1 text-label font-medium text-brand hover:underline">
          <Plus size={13} /> Agregar identificador
        </button>
      )}
      {error && !adding && <p className="mt-2 text-label text-danger">{error}</p>}
    </div>
  );
}
