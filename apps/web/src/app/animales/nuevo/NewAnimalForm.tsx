'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { API_URL, authHeaders } from '@/lib/api';

const inputCls =
  'h-9 w-full rounded-md border border-strong bg-surface px-3 text-[14px] outline-none focus:ring-2 focus:ring-brand';
const labelCls = 'mb-1 block text-[12px] font-medium text-ink-2';

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
        <label className="block">
          <span className={labelCls}>Caravana *</span>
          <input name="tag" required placeholder="472" className={`${inputCls} font-mono`} autoFocus />
        </label>
        <label className="block">
          <span className={labelCls}>Nombre</span>
          <input name="name" placeholder="Opcional" className={inputCls} />
        </label>
        <label className="block">
          <span className={labelCls}>Sexo *</span>
          <select name="sex" required className={inputCls} defaultValue="F">
            <option value="F">Hembra</option>
            <option value="M">Macho</option>
          </select>
        </label>
        <label className="block">
          <span className={labelCls}>Categoría *</span>
          <select name="category_code" required className={inputCls}>
            {categories.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={labelCls}>Fecha de nacimiento</span>
          <input name="birth_date" type="date" className={inputCls} />
        </label>
        <label className="block">
          <span className={labelCls}>Lote</span>
          <select name="lot_id" className={inputCls} defaultValue="">
            <option value="">Sin lote</option>
            {lots.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && <p className="text-[12px] text-danger">{error}</p>}
      <button
        type="submit"
        disabled={saving}
        className="inline-flex h-9 w-full items-center justify-center rounded-md bg-brand text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-50"
      >
        {saving ? 'Guardando…' : 'Registrar animal'}
      </button>
    </form>
  );
}
