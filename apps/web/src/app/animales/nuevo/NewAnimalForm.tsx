'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { API_URL, authHeaders } from '@/lib/api';
import { AnimalPicker, type PickedAnimal } from '@/components/capture';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { Input } from '@/components/Input';
import { Select } from '@/components/Select';

/**
 * Alta mejorada (A360 E4): además de los campos básicos, permite origen (→ evento
 * de alta nacimiento/compra/transferencia), RFID/ID oficial, color, notas, madre/padre
 * (AnimalPicker) y composición racial. POST /animals los persiste en una transacción.
 */
export function NewAnimalForm({ categories, lots, breeds }: { categories: any[]; lots: any[]; breeds: any[] }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [dam, setDam] = useState<PickedAnimal | null>(null);
  const [sire, setSire] = useState<PickedAnimal | null>(null);
  const [selectedBreeds, setSelectedBreeds] = useState<string[]>([]);
  const [showMore, setShowMore] = useState(false);

  const toggleBreed = (id: string) =>
    setSelectedBreeds((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError('');
    const fd = new FormData(e.currentTarget);
    try {
      const res = await fetch(`${API_URL}/animals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders(), 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({
          tag: fd.get('tag'),
          name: fd.get('name') || undefined,
          sex: fd.get('sex'),
          category_code: fd.get('category_code'),
          birth_date: fd.get('birth_date') || undefined,
          birth_date_estimated: fd.get('birth_date_estimated') === 'on',
          lot_id: fd.get('lot_id') || undefined,
          origin: fd.get('origin') || undefined,
          acquisition_date: fd.get('acquisition_date') || undefined,
          coat_color: fd.get('coat_color') || undefined,
          notes: fd.get('notes') || undefined,
          rfid: fd.get('rfid') || undefined,
          official_id: fd.get('official_id') || undefined,
          dam_id: dam?.id ?? undefined,
          sire_id: sire?.id ?? undefined,
          breeds: selectedBreeds.map((id) => ({ breed_id: id })),
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.message?.title ?? body?.title ?? `Error ${res.status}`);
      router.push(`/animales/${body.id}`);
    } catch (err: any) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-[10px] border border-subtle bg-surface p-6 shadow-[var(--shadow-1)]">
      <div className="grid grid-cols-2 gap-4">
        <Field label="Caravana" htmlFor="tag" required>
          <Input id="tag" name="tag" required placeholder="472" className="font-mono" autoFocus />
        </Field>
        <Field label="Nombre" htmlFor="name">
          <Input id="name" name="name" placeholder="Opcional" />
        </Field>
        <Field label="Sexo" htmlFor="sex" required>
          <Select id="sex" name="sex" required defaultValue="F">
            <option value="F">Hembra</option>
            <option value="M">Macho</option>
          </Select>
        </Field>
        <Field label="Categoría" htmlFor="category_code" required>
          <Select id="category_code" name="category_code" required>
            {categories.map((c) => (
              <option key={c.code} value={c.code}>{c.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Fecha de nacimiento" htmlFor="birth_date">
          <Input id="birth_date" name="birth_date" type="date" />
        </Field>
        <Field label="Lote" htmlFor="lot_id">
          <Select id="lot_id" name="lot_id" defaultValue="">
            <option value="">Sin lote</option>
            {lots.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Origen" htmlFor="origin">
          <Select id="origin" name="origin" defaultValue="born">
            <option value="born">Nacido</option>
            <option value="purchased">Comprado</option>
            <option value="transferred">Transferido</option>
          </Select>
        </Field>
        <label className="flex items-end gap-2 pb-2 text-label text-ink-2">
          <input type="checkbox" name="birth_date_estimated" className="size-4 accent-brand" /> Fecha de nacimiento estimada
        </label>
      </div>

      <button type="button" onClick={() => setShowMore((v) => !v)} className="text-label font-medium text-brand hover:underline">
        {showMore ? 'Menos detalles' : 'Más detalles (identificación, genealogía, raza)'}
      </button>

      {showMore && (
        <div className="space-y-4 border-t border-subtle pt-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="RFID" htmlFor="rfid">
              <Input id="rfid" name="rfid" className="font-mono" placeholder="Opcional" />
            </Field>
            <Field label="ID oficial" htmlFor="official_id">
              <Input id="official_id" name="official_id" className="font-mono" placeholder="Opcional" />
            </Field>
            <Field label="Color / capa" htmlFor="coat_color">
              <Input id="coat_color" name="coat_color" placeholder="negra, colorada…" />
            </Field>
            <Field label="Fecha de adquisición" htmlFor="acquisition_date">
              <Input id="acquisition_date" name="acquisition_date" type="date" />
            </Field>
          </div>
          <Field label="Notas" htmlFor="notes">
            <Input id="notes" name="notes" placeholder="Observaciones" />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <span className="mb-1 block text-label font-medium text-ink-2">Madre</span>
              <AnimalPicker animal={dam} onSelect={setDam} />
            </div>
            <div>
              <span className="mb-1 block text-label font-medium text-ink-2">Padre</span>
              <AnimalPicker animal={sire} onSelect={setSire} />
            </div>
          </div>
          {breeds.length > 0 && (
            <div>
              <span className="mb-1.5 block text-label font-medium text-ink-2">Raza / composición</span>
              <div className="flex flex-wrap gap-1.5">
                {breeds.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => toggleBreed(b.id)}
                    className={`inline-flex h-7 items-center rounded-full border px-3 text-label font-medium ${
                      selectedBreeds.includes(b.id) ? 'border-brand bg-brand-soft text-brand' : 'border-subtle bg-surface text-ink-2 hover:bg-sunken'
                    }`}
                  >
                    {b.name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {error && <p className="text-label text-danger">{error}</p>}
      <Button type="submit" size="md" fullWidth loading={saving}>
        {saving ? 'Guardando…' : 'Registrar animal'}
      </Button>
    </form>
  );
}
