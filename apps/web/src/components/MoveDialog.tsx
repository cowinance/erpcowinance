'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { API_URL, authHeaders, apiErrorTitle } from '@/lib/api';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { Input } from '@/components/Input';
import { Select } from '@/components/Select';

export interface MoveLot {
  id: string;
  name: string;
  paddock_name?: string | null;
}

/**
 * Diálogo de movimiento (P3 M-2), compartido por la ficha y la lista. Ofrece SOLO
 * destino = un lote (el potrero se deriva server-side) o «Sacar del lote» → la web
 * nunca envía la combinación incoherente lote+potrero, así que el invariante
 * lote–potrero se honra por construcción (el backend lo defiende igual). Escribe con
 * POST /movements + Idempotency-Key (uuid por apertura → un doble-submit se deduplica).
 */
export function MoveDialog({
  animalIds,
  lots,
  onClose,
  onDone,
}: {
  animalIds: string[];
  lots: MoveLot[];
  onClose: () => void;
  onDone?: (moved: number) => void;
}) {
  const router = useRouter();
  const [dest, setDest] = useState(''); // '' sin elegir · 'clear' sacar del lote · else lotId
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [idemKey] = useState(() => crypto.randomUUID());

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, saving]);

  async function submit() {
    if (!dest) {
      setError('Elegí un destino.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const body: Record<string, unknown> = { animal_ids: animalIds, reason: reason || undefined };
      body.lot_id = dest === 'clear' ? null : dest;
      const res = await fetch(`${API_URL}/movements`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders(), 'Idempotency-Key': idemKey },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(apiErrorTitle(json, `Error ${res.status}`));
      onDone?.(json.moved ?? 0);
      router.refresh();
      onClose();
    } catch (e: any) {
      setError(e.message);
      setSaving(false);
    }
  }

  const count = animalIds.length;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="move-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-[10px] border border-subtle bg-surface p-6 shadow-[var(--shadow-1)]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="move-title" className="text-subheading font-semibold">
          Mover {count === 1 ? 'animal' : `${count} animales`}
        </h2>
        <p className="mt-0.5 mb-4 text-label text-ink-3">El potrero se toma del lote elegido.</p>

        <div className="space-y-4">
          <Field label="Destino" htmlFor="move-dest" required>
            <Select id="move-dest" value={dest} onChange={(e) => setDest(e.currentTarget.value)} invalid={!!error && !dest} autoFocus>
              <option value="">— Elegí un lote —</option>
              {lots.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                  {l.paddock_name ? ` · ${l.paddock_name}` : ''}
                </option>
              ))}
              <option value="clear">Sacar del lote</option>
            </Select>
          </Field>
          <Field label="Motivo" htmlFor="move-reason" help="Opcional (rotación, destete, sanitario, venta…)">
            <Input id="move-reason" value={reason} onChange={(e) => setReason(e.currentTarget.value)} placeholder="Motivo del movimiento" />
          </Field>
        </div>

        {error && (
          <p role="alert" className="mt-4 text-label text-danger">
            {error}
          </p>
        )}

        <div className="mt-6 flex items-center justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={saving} disabled={!dest}>
            {saving ? 'Moviendo…' : 'Mover'}
          </Button>
        </div>
      </div>
    </div>
  );
}
