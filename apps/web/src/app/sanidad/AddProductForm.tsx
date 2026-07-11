'use client';

import { useId, useState } from 'react';
import { API_URL, authHeaders } from '@/lib/api';
import { Field } from '@/components/Field';
import { Input } from '@/components/Input';
import { Select } from '@/components/Select';

export const PRODUCT_TYPES: [string, string][] = [
  ['vaccine', 'Vacuna'],
  ['antibiotic', 'Antibiótico'],
  ['antiparasitic', 'Antiparasitario'],
  ['vitamin', 'Vitamina / Complejo B'],
  ['hormone', 'Hormonal'],
  ['other', 'Otro'],
];

/** Alta de un medicamento veterinario (product_veterinary). Reutilizable. */
export function AddProductForm({
  defaultType,
  onCreated,
  onCancel,
}: {
  defaultType?: string;
  onCreated: (product: any) => void;
  onCancel?: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // ids únicos: AddProductForm puede renderizarse dos veces en /sanidad
  // (ProductPicker de captura + MedicationsPanel) → sin colisión de id.
  const fid = useId();

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError('');
    const fd = new FormData(e.currentTarget);
    try {
      const res = await fetch(`${API_URL}/products-veterinary`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          name: fd.get('name'),
          type: fd.get('type'),
          active_ingredient: fd.get('active_ingredient') || undefined,
          withdrawal_meat_days: fd.get('withdrawal_meat_days') ? Number(fd.get('withdrawal_meat_days')) : undefined,
          withdrawal_milk_hours: fd.get('withdrawal_milk_hours') ? Number(fd.get('withdrawal_milk_hours')) : undefined,
          default_dose: fd.get('default_dose') || undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.message?.title ?? 'No se pudo crear el medicamento');
      onCreated(body);
    } catch (err: any) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-md border border-subtle bg-sunken p-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Nombre" htmlFor={`${fid}-name`} required>
          <Input id={`${fid}-name`} name="name" required autoFocus placeholder="Ej: Complejo B2 / B12" controlSize="md" />
        </Field>
        <Field label="Tipo" htmlFor={`${fid}-type`} required>
          <Select id={`${fid}-type`} name="type" required defaultValue={defaultType ?? 'vitamin'} controlSize="md">
            {PRODUCT_TYPES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Principio activo" htmlFor={`${fid}-active_ingredient`}>
          <Input id={`${fid}-active_ingredient`} name="active_ingredient" placeholder="Ej: Cianocobalamina" controlSize="md" />
        </Field>
        <Field label="Dosis por defecto" htmlFor={`${fid}-default_dose`}>
          <Input id={`${fid}-default_dose`} name="default_dose" placeholder="Ej: 5 ml IM" controlSize="md" />
        </Field>
        <Field label="Retiro carne (días)" htmlFor={`${fid}-withdrawal_meat_days`}>
          <Input id={`${fid}-withdrawal_meat_days`} name="withdrawal_meat_days" type="number" min="0" placeholder="0" controlSize="md" />
        </Field>
        <Field label="Retiro leche (horas)" htmlFor={`${fid}-withdrawal_milk_hours`}>
          <Input id={`${fid}-withdrawal_milk_hours`} name="withdrawal_milk_hours" type="number" min="0" placeholder="0" controlSize="md" />
        </Field>
      </div>
      {error && <p className="text-label text-danger">{error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="h-8 rounded-md bg-brand px-3 text-label font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {saving ? 'Guardando…' : 'Guardar medicamento'}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="h-8 rounded-md border border-strong px-3 text-label font-medium text-ink-2 hover:bg-surface">
            Cancelar
          </button>
        )}
      </div>
    </form>
  );
}
