'use client';

import { useEffect, useState } from 'react';
import { API_URL, authHeaders } from '@/lib/api';
import { Button } from '@/components/Button';
import { KpiCard } from '@/components/ui';
import type { ImportBatch } from './UploadStep';

interface BatchStatus {
  status: string;
  total_rows: number;
  created_count: number;
  skipped_count: number;
  invalid_count: number;
  error_count: number;
}

const TERMINAL = new Set(['completed', 'completed_with_errors', 'failed']);
const POLL_MS = 1500;

/**
 * Paso «Resultado» (P2 P-e.4): tras el commit, hace polling de GET /imports/:id
 * hasta estado terminal, mostrando una barra de progreso derivada de los
 * contadores (created+skipped+invalid+error)/total. En terminal muestra el
 * resumen. No hay estado `failed` para import; `processing` se trata con paciencia
 * (nunca como error). El reporte por-fila + descarga llegan en P-e.5.
 */
export function ResultStep({ batch, onRestart }: { batch: ImportBatch; onRestart: () => void }) {
  const [state, setState] = useState<BatchStatus | null>(null);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    async function tick() {
      try {
        const res = await fetch(`${API_URL}/imports/${batch.id}`, { headers: authHeaders() });
        if (!res.ok) throw new Error(`Error ${res.status}`);
        const body = (await res.json()) as BatchStatus;
        if (!alive) return;
        setState(body);
        setRetrying(false);
        if (!TERMINAL.has(body.status)) timer = setTimeout(tick, POLL_MS);
      } catch {
        if (!alive) return;
        setRetrying(true); // blip de red/token: reintenta suave, sin romper la vista
        timer = setTimeout(tick, POLL_MS * 2);
      }
    }
    tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [batch]);

  const processed = state ? state.created_count + state.skipped_count + state.invalid_count + state.error_count : 0;
  const total = state?.total_rows ?? batch.total_rows ?? 0;
  const pct = total > 0 ? Math.round((processed / total) * 100) : 0;
  const terminal = state ? TERMINAL.has(state.status) : false;
  const withErrors = state?.status === 'completed_with_errors' || (state?.error_count ?? 0) > 0;

  if (!terminal) {
    return (
      <div className="rounded-[10px] border border-subtle bg-surface p-6 shadow-[var(--shadow-1)]">
        <p className="text-body font-medium text-ink">Procesando…</p>
        <div
          className="mt-3 h-2 w-full overflow-hidden rounded-full bg-sunken"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Progreso de importación"
        >
          <div className="h-full rounded-full bg-brand transition-all duration-300" style={{ width: `${pct}%` }} />
        </div>
        <p aria-live="polite" className="mt-2 text-label text-ink-3">
          {retrying ? 'Reconectando…' : `Procesando ${processed} de ${total}…`}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div aria-live="polite" className="sr-only">
        Importación {withErrors ? 'completada con avisos' : 'completada'}: {state!.created_count} creados, {state!.skipped_count} omitidos, {state!.invalid_count} inválidos.
      </div>
      <div
        className={`rounded-[10px] border p-4 text-body ${
          withErrors ? 'border-warning/30 bg-warning/10 text-warning' : 'border-success/30 bg-success/10 text-success'
        }`}
      >
        {withErrors ? 'Importación completada con avisos.' : '¡Importación completada!'}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="Creados" value={state!.created_count} tone="success" />
        <KpiCard label="Omitidos" value={state!.skipped_count} tone="warning" />
        <KpiCard label="Inválidos" value={state!.invalid_count} tone="danger" />
        <KpiCard label="Errores" value={state!.error_count} tone={state!.error_count > 0 ? 'danger' : undefined} />
      </div>
      <div className="rounded-[10px] border border-subtle bg-surface p-4 text-label text-ink-3 shadow-[var(--shadow-1)]">
        El reporte por fila detallado y la descarga llegan en la próxima entrega (P-e.5).
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={onRestart}>Importar otro archivo</Button>
      </div>
    </div>
  );
}
