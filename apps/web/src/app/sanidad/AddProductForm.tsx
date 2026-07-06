'use client';

import { useState } from 'react';
import { API_URL, authHeaders } from '@/lib/api';
import { inputCls, labelCls } from '@/components/capture';

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
        <label className="block">
          <span className={labelCls}>Nombre *</span>
          <input name="name" required autoFocus placeholder="Ej: Complejo B2 / B12" className={inputCls} />
        </label>
        <label className="block">
          <span className={labelCls}>Tipo *</span>
          <select name="type" required className={inputCls} defaultValue={defaultType ?? 'vitamin'}>
            {PRODUCT_TYPES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={labelCls}>Principio activo</span>
          <input name="active_ingredient" placeholder="Ej: Cianocobalamina" className={inputCls} />
        </label>
        <label className="block">
          <span className={labelCls}>Dosis por defecto</span>
          <input name="default_dose" placeholder="Ej: 5 ml IM" className={inputCls} />
        </label>
        <label className="block">
          <span className={labelCls}>Retiro carne (días)</span>
          <input name="withdrawal_meat_days" type="number" min="0" placeholder="0" className={inputCls} />
        </label>
        <label className="block">
          <span className={labelCls}>Retiro leche (horas)</span>
          <input name="withdrawal_milk_hours" type="number" min="0" placeholder="0" className={inputCls} />
        </label>
      </div>
      {error && <p className="text-[12px] text-danger">{error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="h-8 rounded-md bg-brand px-3 text-[12px] font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {saving ? 'Guardando…' : 'Guardar medicamento'}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="h-8 rounded-md border border-strong px-3 text-[12px] font-medium text-ink-2 hover:bg-surface">
            Cancelar
          </button>
        )}
      </div>
    </form>
  );
}
