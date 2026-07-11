'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { API_URL, authHeaders } from '@/lib/api';
import { Field } from '@/components/Field';
import { Input } from '@/components/Input';
import { Select } from '@/components/Select';

export function NewAnimalForm({ categories, lots }: { categories: any[]; lots: any[] }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

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
          lot_id: fd.get('lot_id') || undefined,
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
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
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
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {error && <p className="text-label text-danger">{error}</p>}
      <button
        type="submit"
        disabled={saving}
        className="inline-flex h-9 w-full items-center justify-center rounded-md bg-brand text-body font-medium text-white hover:opacity-90 disabled:opacity-50"
      >
        {saving ? 'Guardando…' : 'Registrar animal'}
      </button>
    </form>
  );
}
