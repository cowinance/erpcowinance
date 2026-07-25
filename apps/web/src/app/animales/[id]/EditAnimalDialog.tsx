'use client';

/**
 * Edición completa del animal desde la ficha (A360 E2). Escribe con PUT /animals/:id
 * (regla única updateAnimal: diff-aware, validaciones, sync + timeline). El lote/potrero
 * NO se editan aquí — viajan por «Mover» (servicio de movimientos); la foto por la galería.
 * Madre/padre se eligen con AnimalPicker (búsqueda por caravana).
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil } from 'lucide-react';
import { API_URL, authHeaders, apiErrorTitle } from '@/lib/api';
import { AnimalPicker, type PickedAnimal } from '@/components/capture';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { Input } from '@/components/Input';
import { Select } from '@/components/Select';

export function EditAnimalButton({ animal, categories, breeds }: { animal: any; categories: any[]; breeds: any[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <Pencil size={14} className="mr-1.5" /> Editar
      </Button>
      {open && <EditAnimalDialog animal={animal} categories={categories} breeds={breeds} onClose={() => setOpen(false)} />}
    </>
  );
}

function EditAnimalDialog({ animal, categories, breeds, onClose }: { animal: any; categories: any[]; breeds: any[]; onClose: () => void }) {
  const router = useRouter();
  const visual = animal.identifiers?.find((i: any) => i.type === 'visual');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [tag, setTag] = useState(visual?.value ?? '');
  const [name, setName] = useState(animal.name ?? '');
  const [sex, setSex] = useState(animal.sex ?? 'F');
  const [categoryCode, setCategoryCode] = useState(animal.category_code ?? '');
  const [birthDate, setBirthDate] = useState(animal.birth_date ? String(animal.birth_date).slice(0, 10) : '');
  const [birthEstimated, setBirthEstimated] = useState(!!animal.birth_date_estimated);
  const [origin, setOrigin] = useState(animal.origin ?? 'born');
  const [acqDate, setAcqDate] = useState(animal.acquisition_date ? String(animal.acquisition_date).slice(0, 10) : '');
  const [coat, setCoat] = useState(animal.coat_color ?? '');
  const [notes, setNotes] = useState(animal.notes ?? '');
  const [dam, setDam] = useState<PickedAnimal | null>(
    animal.genealogy?.dam_id ? { id: animal.genealogy.dam_id, tag: animal.genealogy.dam_tag ?? '—' } : null,
  );
  const [sire, setSire] = useState<PickedAnimal | null>(
    animal.genealogy?.sire_id ? { id: animal.genealogy.sire_id, tag: animal.genealogy.sire_tag ?? '—' } : null,
  );
  const initialBreeds: string[] = (animal.breeds ?? []).map((b: any) => b.breed_id).filter(Boolean);
  const [selectedBreeds, setSelectedBreeds] = useState<string[]>(initialBreeds);
  const toggleBreed = (id: string) => setSelectedBreeds((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const breedsChanged = () =>
    selectedBreeds.length !== initialBreeds.length || selectedBreeds.some((id) => !initialBreeds.includes(id));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !saving && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, saving]);

  async function submit() {
    setSaving(true);
    setError('');
    try {
      const body = {
        visual_tag: tag,
        name,
        sex,
        category_code: categoryCode,
        birth_date: birthDate,
        birth_date_estimated: birthEstimated,
        origin,
        acquisition_date: acqDate,
        coat_color: coat,
        notes,
        dam_id: dam?.id ?? null,
        sire_id: sire?.id ?? null,
      };
      const res = await fetch(`${API_URL}/animals/${animal.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(apiErrorTitle(json, `Error ${res.status}`));
      // La raza tiene su propia regla (PUT /animals/:id/breeds) — solo si cambió.
      if (breedsChanged()) {
        const br = await fetch(`${API_URL}/animals/${animal.id}/breeds`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify({ breeds: selectedBreeds.map((id) => ({ breed_id: id })) }),
        });
        const bj = await br.json().catch(() => ({}));
        if (!br.ok) throw new Error(apiErrorTitle(bj, `Error ${br.status}`));
      }
      router.refresh();
      onClose();
    } catch (e: any) {
      setError(e.message);
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 py-10" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="w-full max-w-lg rounded-[10px] border border-subtle bg-surface p-6 shadow-[var(--shadow-1)]" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-subheading font-semibold">Editar animal</h2>
        <p className="mt-0.5 mb-4 text-label text-ink-3">El lote se cambia con «Mover»; la foto, desde la galería.</p>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Caravana visual" htmlFor="e-tag" required>
            <Input id="e-tag" value={tag} onChange={(e) => setTag(e.currentTarget.value)} className="font-mono" />
          </Field>
          <Field label="Nombre" htmlFor="e-name">
            <Input id="e-name" value={name} onChange={(e) => setName(e.currentTarget.value)} placeholder="Opcional" />
          </Field>
          <Field label="Sexo" htmlFor="e-sex">
            <Select id="e-sex" value={sex} onChange={(e) => setSex(e.currentTarget.value)}>
              <option value="F">Hembra</option>
              <option value="M">Macho</option>
            </Select>
          </Field>
          <Field label="Categoría" htmlFor="e-cat">
            <Select id="e-cat" value={categoryCode} onChange={(e) => setCategoryCode(e.currentTarget.value)}>
              {(categories ?? []).map((c) => (
                <option key={c.code} value={c.code}>{c.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Fecha de nacimiento" htmlFor="e-bd">
            <Input id="e-bd" type="date" value={birthDate} onChange={(e) => setBirthDate(e.currentTarget.value)} />
          </Field>
          <Field label="Origen" htmlFor="e-origin">
            <Select id="e-origin" value={origin} onChange={(e) => setOrigin(e.currentTarget.value)}>
              <option value="born">Nacido</option>
              <option value="purchased">Comprado</option>
              <option value="transferred">Transferido</option>
            </Select>
          </Field>
          <label className="col-span-2 -mt-1 flex items-center gap-2 text-label text-ink-2">
            <input type="checkbox" checked={birthEstimated} onChange={(e) => setBirthEstimated(e.currentTarget.checked)} className="size-4 accent-brand" />
            Fecha de nacimiento estimada
          </label>
          <Field label="Fecha de adquisición" htmlFor="e-acq">
            <Input id="e-acq" type="date" value={acqDate} onChange={(e) => setAcqDate(e.currentTarget.value)} />
          </Field>
          <Field label="Color / capa" htmlFor="e-coat">
            <Input id="e-coat" value={coat} onChange={(e) => setCoat(e.currentTarget.value)} placeholder="negra, colorada…" />
          </Field>
        </div>

        <div className="mt-4">
          <Field label="Notas" htmlFor="e-notes">
            <Input id="e-notes" value={notes} onChange={(e) => setNotes(e.currentTarget.value)} placeholder="Observaciones" />
          </Field>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-4">
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
          <div className="mt-4">
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

        {error && <p role="alert" className="mt-4 text-label text-danger">{error}</p>}

        <div className="mt-6 flex items-center justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={submit} loading={saving}>{saving ? 'Guardando…' : 'Guardar cambios'}</Button>
        </div>
      </div>
    </div>
  );
}
