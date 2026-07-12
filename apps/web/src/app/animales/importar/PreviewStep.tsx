'use client';

import { useEffect, useState } from 'react';
import { API_URL, authHeaders } from '@/lib/api';
import { Button } from '@/components/Button';
import { KpiCard } from '@/components/ui';
import type { ImportBatch } from './UploadStep';

interface RowError {
  field: string;
  code: string;
  message: string;
}
interface Verdict {
  row_number: number;
  verdict: 'valid' | 'invalid' | 'duplicate';
  errors?: RowError[];
  reason?: string;
}
export interface PreviewCounts {
  total: number;
  valid: number;
  invalid: number;
  duplicate: number;
}
interface Preview {
  counts: PreviewCounts;
  sample: Verdict[];
}

const PREVIEW_ERROR_COPY: Record<string, string> = {
  'import.batch_not_editable': 'Volvé a mapear y reintentá.',
  'import.mapping_missing_required': 'Faltan columnas obligatorias en el mapeo.',
};

/**
 * Paso «Previsualizar» (P2 P-e.3): al montar lanza POST /imports/:id/preview y
 * muestra los conteos EXACTOS (sobre todo el archivo) + una MUESTRA de veredictos
 * (primeras 20 filas). Es una estimación: el commit revalida. Sin cambios de
 * backend. Confirmar avanza al paso 4 (commit, P-e.4).
 */
export function PreviewStep({
  batch,
  onConfirm,
  onBack,
}: {
  batch: ImportBatch;
  onConfirm: (counts: PreviewCounts) => void;
  onBack: () => void;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const res = await fetch(`${API_URL}/imports/${batch.id}/preview`, { method: 'POST', headers: authHeaders() });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          const code = body?.message?.code ?? body?.code;
          const title = body?.message?.title ?? body?.title;
          throw new Error((code && PREVIEW_ERROR_COPY[code]) || title || `Error ${res.status}`);
        }
        if (alive) setPreview(body as Preview);
      } catch (e: any) {
        if (alive) setError(e.message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [batch]);

  if (loading) {
    return <div className="rounded-[10px] border border-subtle bg-surface p-6 text-body text-ink-3 shadow-[var(--shadow-1)]">Analizando filas…</div>;
  }
  if (error) {
    return (
      <div className="rounded-[10px] border border-subtle bg-surface p-6 shadow-[var(--shadow-1)]">
        <p role="alert" className="text-body text-danger">
          {error}
        </p>
        <Button variant="secondary" className="mt-4" onClick={onBack}>
          Volver a mapear
        </Button>
      </div>
    );
  }
  if (!preview) return null;

  const { counts, sample } = preview;
  const canConfirm = counts.valid > 0;

  return (
    <div className="space-y-6">
      <div aria-live="polite" className="sr-only">
        Previsualización lista: {counts.valid} válidas, {counts.invalid} inválidas, {counts.duplicate} duplicadas.
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="Total" value={counts.total} />
        <KpiCard label="Válidas" value={counts.valid} tone="success" hint="se crearán" />
        <KpiCard label="Duplicadas" value={counts.duplicate} tone="warning" hint="se omiten" />
        <KpiCard label="Inválidas" value={counts.invalid} tone="danger" hint="no se crean" />
      </div>

      <div className="overflow-x-auto rounded-[10px] border border-subtle bg-surface shadow-[var(--shadow-1)]">
        <table className="w-full text-body">
          <caption className="px-4 pt-4 text-left text-label text-ink-3">
            Muestra de las primeras {sample.length} filas · los totales de arriba son sobre todo el archivo.
          </caption>
          <thead>
            <tr className="border-b border-subtle text-label text-ink-3">
              <th scope="col" className="px-4 py-2 text-left font-medium">Fila</th>
              <th scope="col" className="px-4 py-2 text-left font-medium">Veredicto</th>
              <th scope="col" className="px-4 py-2 text-left font-medium">Detalle</th>
            </tr>
          </thead>
          <tbody>
            {sample.map((v) => (
              <tr key={v.row_number} className="border-b border-subtle last:border-0">
                <td className="tnum px-4 py-2 text-ink-2">{v.row_number}</td>
                <td className="px-4 py-2">
                  <VerdictBadge v={v.verdict} />
                </td>
                <td className="px-4 py-2 text-ink-2">{detail(v)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" onClick={onBack}>
          Volver a mapear
        </Button>
        <Button onClick={() => onConfirm(counts)} disabled={!canConfirm}>
          Continuar
        </Button>
        {!canConfirm && <span className="text-label text-ink-3">No hay filas válidas para importar.</span>}
      </div>
    </div>
  );
}

const VERDICT: Record<Verdict['verdict'], { label: string; cls: string }> = {
  valid: { label: 'Válida', cls: 'bg-success/10 text-success border-success/30' },
  duplicate: { label: 'Duplicada', cls: 'bg-warning/10 text-warning border-warning/30' },
  invalid: { label: 'Inválida', cls: 'bg-danger/10 text-danger border-danger/30' },
};

/** Badge de veredicto local (no reutiliza StatusBadge, cuyo mapa es de estados de animal). */
function VerdictBadge({ v }: { v: Verdict['verdict'] }) {
  const s = VERDICT[v] ?? VERDICT.invalid;
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-caption font-medium ${s.cls}`}>{s.label}</span>;
}

function detail(v: Verdict): string {
  if (v.verdict === 'invalid') return (v.errors ?? []).map((e) => `${e.field}: ${e.message}`).join('; ') || 'Inválida';
  if (v.verdict === 'duplicate') return v.reason ?? 'Duplicada';
  return '—';
}
