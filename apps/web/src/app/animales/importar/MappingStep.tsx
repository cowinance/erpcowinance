'use client';

import { useEffect, useMemo, useState } from 'react';
import { API_URL, authHeaders } from '@/lib/api';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { Select } from '@/components/Select';
import type { ImportBatch } from './UploadStep';

interface FieldDef {
  field: string;
  label: string;
  required: boolean;
}

const PUT_ERROR_COPY: Record<string, string> = {
  'import.mapping_missing_required': 'Faltan columnas obligatorias por asignar.',
  'import.invalid_mapping': 'El mapeo no es válido.',
  'import.batch_not_editable': 'Este import ya no admite cambios de mapeo.',
};

/**
 * Paso «Mapear» (P2 P-e.2): asigna cada campo del descriptor a una columna del
 * CSV. El catálogo de campos viene de GET /imports/animal/fields (fuente única);
 * las columnas y la sugerencia inicial ya están en el batch (de P-e.1). Al
 * continuar persiste con PUT /imports/:id/mapping (batch → mapped).
 */
export function MappingStep({
  batch,
  onMapped,
  onBack,
}: {
  batch: ImportBatch;
  onMapped: (b: ImportBatch) => void;
  onBack: () => void;
}) {
  const [fields, setFields] = useState<FieldDef[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [assign, setAssign] = useState<Record<string, string>>({}); // campo → header ('' = sin asignar)
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/imports/animal/fields`, { headers: authHeaders() });
        if (!res.ok) throw new Error(`Error ${res.status}`);
        const defs = (await res.json()) as FieldDef[];
        if (!alive) return;
        setFields(defs);
        const init: Record<string, string> = {};
        for (const d of defs) init[d.field] = batch.mapping?.[d.field] ?? ''; // precarga desde la sugerencia
        setAssign(init);
      } catch {
        if (alive) setLoadError('No se pudieron cargar los campos. Recargá la página.');
      }
    })();
    return () => {
      alive = false;
    };
  }, [batch]);

  // header → campo que lo usa (para deshabilitar el mismo header en otros selects)
  const usedHeaders = useMemo(() => {
    const m = new Map<string, string>();
    for (const [f, h] of Object.entries(assign)) if (h) m.set(h, f);
    return m;
  }, [assign]);

  const missingRequired = useMemo(
    () => (fields ?? []).filter((d) => d.required && !assign[d.field]),
    [fields, assign],
  );

  async function submit() {
    if (missingRequired.length) {
      setError(`Asigná las columnas obligatorias: ${missingRequired.map((d) => d.label).join(', ')}`);
      return;
    }
    setSaving(true);
    setError('');
    try {
      const mapping: Record<string, string> = {};
      for (const [f, h] of Object.entries(assign)) if (h) mapping[f] = h;
      const res = await fetch(`${API_URL}/imports/${batch.id}/mapping`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ mapping }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const code = body?.message?.code ?? body?.code;
        const title = body?.message?.title ?? body?.title;
        throw new Error((code && PUT_ERROR_COPY[code]) || title || `Error ${res.status}`);
      }
      // body es ImportBatchDto (sin headers): preservamos los headers del batch en curso
      onMapped({ ...batch, ...(body as Partial<ImportBatch>) });
    } catch (e: any) {
      setError(e.message);
      setSaving(false);
    }
  }

  if (loadError) {
    return <div className="rounded-[10px] border border-subtle bg-surface p-6 text-body text-danger shadow-[var(--shadow-1)]" role="alert">{loadError}</div>;
  }
  if (!fields) {
    return <div className="rounded-[10px] border border-subtle bg-surface p-6 text-body text-ink-3 shadow-[var(--shadow-1)]">Cargando campos…</div>;
  }

  return (
    <div className="rounded-[10px] border border-subtle bg-surface p-6 shadow-[var(--shadow-1)]">
      <p className="mb-4 text-body text-ink-3">
        Asigná cada dato del animal a una columna de tu archivo. Los campos marcados con <span aria-hidden="true">*</span> son obligatorios.
      </p>
      <div className="space-y-4">
        {fields.map((d) => {
          const value = assign[d.field] ?? '';
          return (
            <Field key={d.field} label={d.label} htmlFor={`map-${d.field}`} required={d.required}>
              <Select
                id={`map-${d.field}`}
                value={value}
                invalid={d.required && !value && !!error}
                onChange={(e) => setAssign((a) => ({ ...a, [d.field]: e.currentTarget.value }))}
              >
                {!d.required && <option value="">— Sin asignar —</option>}
                {d.required && value === '' && (
                  <option value="" disabled>
                    — Elegí una columna —
                  </option>
                )}
                {batch.headers.map((h) => {
                  const takenByOther = usedHeaders.get(h) && usedHeaders.get(h) !== d.field;
                  return (
                    <option key={h} value={h} disabled={!!takenByOther}>
                      {h}
                      {takenByOther ? ' (ya asignada)' : ''}
                    </option>
                  );
                })}
              </Select>
            </Field>
          );
        })}
      </div>
      {error && (
        <p role="alert" className="mt-4 text-label text-danger">
          {error}
        </p>
      )}
      <div className="mt-6 flex items-center gap-2">
        <Button variant="secondary" onClick={onBack}>
          Volver a subir
        </Button>
        <Button loading={saving} onClick={submit}>
          {saving ? 'Guardando…' : 'Previsualizar'}
        </Button>
      </div>
    </div>
  );
}
