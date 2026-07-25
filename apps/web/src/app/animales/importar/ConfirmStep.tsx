'use client';

import { useState } from 'react';
import { API_URL, authHeaders, apiErrorTitle } from '@/lib/api';
import { Button } from '@/components/Button';
import type { ImportBatch } from './UploadStep';
import type { PreviewCounts } from './PreviewStep';

const COMMIT_ERROR_COPY: Record<string, string> = {
  'import.not_previewed': 'Volvé a previsualizar antes de confirmar.',
  'import.mapping_missing_required': 'Faltan columnas obligatorias en el mapeo.',
  'import.invalid_reconcile_mode': 'Modo de reconciliación no soportado.',
};

/**
 * Paso «Confirmar» (P2 P-e.4): puerta deliberada e irreversible. Muestra el
 * resumen de lo que hará el commit y, al aceptar, hace POST /imports/:id/commit
 * (batch → queued). El seguimiento del procesamiento ocurre en el paso Resultado.
 */
export function ConfirmStep({
  batch,
  counts,
  onCommitted,
  onBack,
}: {
  batch: ImportBatch;
  counts: PreviewCounts;
  onCommitted: () => void;
  onBack: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function commit() {
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`${API_URL}/imports/${batch.id}/commit`, { method: 'POST', headers: authHeaders() });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const code = body?.message?.code ?? body?.code;
        const title = apiErrorTitle(body, '');
        throw new Error((code && COMMIT_ERROR_COPY[code]) || title || `Error ${res.status}`);
      }
      onCommitted();
    } catch (e: any) {
      setError(e.message);
      setSaving(false);
    }
  }

  return (
    <div className="rounded-[10px] border border-subtle bg-surface p-6 shadow-[var(--shadow-1)]">
      <p className="text-body font-medium text-ink">Vas a importar animales. Esta acción no se puede deshacer.</p>
      <ul className="mt-4 space-y-1.5 text-body text-ink-2">
        <li>
          Se crearán <strong className="tnum text-success">{counts.valid}</strong> animales.
        </li>
        <li>
          Se omiten <strong className="tnum text-warning">{counts.duplicate}</strong> duplicadas.
        </li>
        <li>
          Se descartan <strong className="tnum text-danger">{counts.invalid}</strong> inválidas.
        </li>
      </ul>
      <p className="mt-3 text-label text-ink-3">Se procesa en segundo plano; vas a ver el progreso en la siguiente pantalla.</p>

      {error && (
        <p role="alert" className="mt-4 text-label text-danger">
          {error}
        </p>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <Button variant="secondary" onClick={onBack} disabled={saving}>
          Volver
        </Button>
        <Button onClick={commit} loading={saving} disabled={counts.valid === 0}>
          {saving ? 'Enviando…' : `Importar ${counts.valid} animales`}
        </Button>
      </div>
    </div>
  );
}
