'use client';

import { useId, useState } from 'react';
import { API_URL, authHeaders } from '@/lib/api';
import { Button } from '@/components/Button';
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

/**
 * Alta de un medicamento veterinario (product_veterinary). Reutilizable.
 *
 * **NO renderiza un `<form>`, y es a propósito.** Se usa dentro del formulario de captura de
 * `/sanidad`, y un `<form>` anidado en otro rompe de una forma que no se ve: React no dispara el
 * `onSubmit` del interno, así que nunca corre `preventDefault()` y el navegador hace un envío
 * NATIVO por GET — los datos del medicamento terminan en la barra de direcciones
 * (`/sanidad?name=Aftosa+Bivalente&type=vaccine…`), la página se recarga y no se guarda nada. El
 * usuario ve que el formulario «se cierra» y la vacuna nunca aparece en la lista.
 *
 * Con un `<div>` y un botón que llama al handler directamente, el componente se puede dropear en
 * cualquier lado sin que vuelva a pasar. La validación de obligatorios se hace acá, que es lo que
 * el `required` del navegador dejaba de cubrir.
 */
export function AddProductForm({
  defaultType,
  onCreated,
  onCancel,
  items = [],
}: {
  defaultType?: string;
  onCreated: (product: any) => void;
  onCancel?: () => void;
  items?: any[];
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [f, setF] = useState({
    name: '',
    type: defaultType ?? 'vitamin',
    active_ingredient: '',
    default_dose: '',
    withdrawal_meat_days: '',
    withdrawal_milk_hours: '',
    inventory_item_id: '',
  });
  const upd = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  // ids únicos: AddProductForm puede renderizarse dos veces en /sanidad
  // (ProductPicker de captura + MedicationsPanel) → sin colisión de id.
  const fid = useId();

  async function submit() {
    if (saving) return;
    if (!f.name.trim()) return setError('El nombre es obligatorio.');
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`${API_URL}/products-veterinary`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          name: f.name.trim(),
          type: f.type,
          active_ingredient: f.active_ingredient || undefined,
          withdrawal_meat_days: f.withdrawal_meat_days ? Number(f.withdrawal_meat_days) : undefined,
          withdrawal_milk_hours: f.withdrawal_milk_hours ? Number(f.withdrawal_milk_hours) : undefined,
          default_dose: f.default_dose || undefined,
          inventory_item_id: f.inventory_item_id || undefined,
        }),
      });
      const body = await res.json();
      // La API devuelve `{code, title}` en el cuerpo; leer `body.message.title` daba siempre
      // undefined y el usuario veía el texto genérico en vez del motivo real.
      if (!res.ok) throw new Error(body?.title ?? body?.message?.title ?? 'No se pudo crear el medicamento');
      onCreated(body);
    } catch (err: any) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3 rounded-md border border-subtle bg-sunken p-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Nombre" htmlFor={`${fid}-name`} required>
          <Input
            id={`${fid}-name`}
            value={f.name}
            onChange={upd('name')}
            autoFocus
            placeholder="Ej: Complejo B2 / B12"
            controlSize="md"
            // Enter guarda, que es lo que espera cualquiera que escribe el nombre y aprieta Enter.
            // Sin `<form>` no hay submit implícito, así que se ata a mano.
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submit();
              }
            }}
          />
        </Field>
        <Field label="Tipo" htmlFor={`${fid}-type`} required>
          <Select id={`${fid}-type`} value={f.type} onChange={upd('type')} controlSize="md">
            {PRODUCT_TYPES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Principio activo" htmlFor={`${fid}-active_ingredient`}>
          <Input id={`${fid}-active_ingredient`} value={f.active_ingredient} onChange={upd('active_ingredient')} placeholder="Ej: Cianocobalamina" controlSize="md" />
        </Field>
        <Field label="Dosis por defecto" htmlFor={`${fid}-default_dose`}>
          <Input id={`${fid}-default_dose`} value={f.default_dose} onChange={upd('default_dose')} placeholder="Ej: 5 ml IM" controlSize="md" />
        </Field>
        <Field label="Retiro carne (días)" htmlFor={`${fid}-withdrawal_meat_days`}>
          <Input id={`${fid}-withdrawal_meat_days`} value={f.withdrawal_meat_days} onChange={upd('withdrawal_meat_days')} type="number" min="0" placeholder="0" controlSize="md" />
        </Field>
        <Field label="Retiro leche (horas)" htmlFor={`${fid}-withdrawal_milk_hours`}>
          <Input id={`${fid}-withdrawal_milk_hours`} value={f.withdrawal_milk_hours} onChange={upd('withdrawal_milk_hours')} type="number" min="0" placeholder="0" controlSize="md" />
        </Field>
        {items.length > 0 && (
          <Field label="Ítem de inventario (descuenta stock)" htmlFor={`${fid}-inventory_item_id`}>
            <Select id={`${fid}-inventory_item_id`} value={f.inventory_item_id} onChange={upd('inventory_item_id')} controlSize="md">
              <option value="">Sin enlazar</option>
              {items.map((it) => (
                <option key={it.id} value={it.id}>{it.name} ({it.unit})</option>
              ))}
            </Select>
          </Field>
        )}
      </div>
      {error && (
        <p role="alert" className="text-label text-danger">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        {/* `type="button"`: si fuera submit y este componente cayera dentro de otro formulario,
            enviaría el de afuera. Acá no hay form propio, así que el guardado va por onClick. */}
        <Button type="button" size="sm" loading={saving} onClick={submit}>
          {saving ? 'Guardando…' : 'Guardar medicamento'}
        </Button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="h-8 rounded-md border border-strong px-3 text-label font-medium text-ink-2 hover:bg-surface">
            Cancelar
          </button>
        )}
      </div>
    </div>
  );
}
