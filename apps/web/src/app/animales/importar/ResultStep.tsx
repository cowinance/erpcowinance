'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
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

interface RowError {
  field: string;
  code: string;
  message: string;
}
interface LinkWarning {
  field: string;
  outcome: string;
}
export interface ImportRow {
  id: string;
  row_number: number;
  raw: Record<string, string>;
  status: string;
  skip_reason: string | null;
  errors: RowError[] | null;
  warnings: LinkWarning[] | null;
  resulting_entity_id: string | null;
}

const TERMINAL = new Set(['completed', 'completed_with_errors', 'failed']);
const POLL_MS = 1500;
const PAGE = 100;
const CSV_PAGE = 500;

/**
 * Paso «Resultado» (P2 P-e.4 + P-e.5): tras el commit, polling de GET /imports/:id
 * hasta terminal (barra de progreso por contadores). En terminal: resumen +
 * REPORTE por-fila paginado (GET /rows por cursor, «Cargar más») + descarga CSV
 * anotado (pagina TODAS las filas). No hay estado `failed`; `processing` con
 * paciencia. Sin cambios de backend.
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
        setRetrying(true);
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

      <Report batch={batch} />

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={onRestart}>Importar otro archivo</Button>
      </div>
    </div>
  );
}

/** Reporte por-fila paginado + descarga CSV anotado. */
function Report({ batch }: { batch: ImportBatch }) {
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');
  const started = useRef(false);
  const tagHeader = batch.mapping?.tag;

  async function loadPage(c: string | null) {
    setLoading(true);
    setError('');
    try {
      const url = `${API_URL}/imports/${batch.id}/rows?limit=${PAGE}` + (c ? `&cursor=${encodeURIComponent(c)}` : '');
      const res = await fetch(url, { headers: authHeaders() });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const body = (await res.json()) as { data: ImportRow[]; next_cursor: string | null };
      setRows((prev) => [...(prev ?? []), ...body.data]);
      setCursor(body.next_cursor);
    } catch {
      setError('No se pudieron cargar las filas. Reintentá.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void loadPage(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function downloadCsv() {
    setDownloading(true);
    setError('');
    try {
      const all: ImportRow[] = [];
      let c: string | null = null;
      do {
        const url = `${API_URL}/imports/${batch.id}/rows?limit=${CSV_PAGE}` + (c ? `&cursor=${encodeURIComponent(c)}` : '');
        const res = await fetch(url, { headers: authHeaders() });
        if (!res.ok) throw new Error(`Error ${res.status}`);
        const body = (await res.json()) as { data: ImportRow[]; next_cursor: string | null };
        all.push(...body.data);
        c = body.next_cursor;
      } while (c);
      const csv = buildReportCsv(all);
      const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objUrl;
      a.download = `reporte-importacion-${batch.id.slice(0, 8)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objUrl);
    } catch {
      setError('No se pudo generar el CSV. Reintentá.');
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-body font-semibold text-ink">Reporte por fila</h2>
        <Button variant="secondary" size="sm" onClick={downloadCsv} loading={downloading}>
          {downloading ? 'Generando…' : 'Descargar reporte (CSV)'}
        </Button>
      </div>

      {error && (
        <p role="alert" className="text-label text-danger">
          {error}
        </p>
      )}

      <div className="overflow-x-auto rounded-[10px] border border-subtle bg-surface shadow-[var(--shadow-1)]">
        <table className="w-full text-body">
          <caption className="sr-only">Resultado por fila de la importación</caption>
          <thead>
            <tr className="border-b border-subtle text-label text-ink-3">
              <th scope="col" className="px-4 py-2 text-left font-medium">Fila</th>
              <th scope="col" className="px-4 py-2 text-left font-medium">Estado</th>
              <th scope="col" className="px-4 py-2 text-left font-medium">Caravana</th>
              <th scope="col" className="px-4 py-2 text-left font-medium">Detalle</th>
              <th scope="col" className="px-4 py-2 text-left font-medium">Animal</th>
            </tr>
          </thead>
          <tbody>
            {(rows ?? []).map((r) => (
              <tr key={r.id} className="border-b border-subtle last:border-0">
                <td className="tnum px-4 py-2 text-ink-2">{r.row_number}</td>
                <td className="px-4 py-2">
                  <RowStatusBadge status={r.status} />
                </td>
                <td className="px-4 py-2 font-mono text-ink-2">{(tagHeader && r.raw?.[tagHeader]) || '—'}</td>
                <td className="px-4 py-2 text-ink-2">{rowDetail(r) || '—'}</td>
                <td className="px-4 py-2">
                  {r.resulting_entity_id ? (
                    <Link href={`/animales/${r.resulting_entity_id}`} className="text-brand hover:underline">
                      Ver
                    </Link>
                  ) : (
                    <span className="text-ink-3">—</span>
                  )}
                </td>
              </tr>
            ))}
            {rows === null && (
              <tr>
                <td colSpan={5} className="px-4 py-3 text-label text-ink-3">
                  Cargando filas…
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {cursor && (
        <Button variant="secondary" size="sm" onClick={() => loadPage(cursor)} loading={loading}>
          {loading ? 'Cargando…' : 'Cargar más filas'}
        </Button>
      )}
    </div>
  );
}

const ROW_STATUS: Record<string, { label: string; cls: string }> = {
  created: { label: 'Creado', cls: 'bg-success/10 text-success border-success/30' },
  skipped: { label: 'Omitido', cls: 'bg-warning/10 text-warning border-warning/30' },
  invalid: { label: 'Inválido', cls: 'bg-danger/10 text-danger border-danger/30' },
};

function RowStatusBadge({ status }: { status: string }) {
  const s = ROW_STATUS[status] ?? { label: status, cls: 'bg-sunken text-ink-2 border-subtle' };
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-caption font-medium ${s.cls}`}>{s.label}</span>;
}

/** Detalle legible de una fila según su estado (invalid → errores, skipped → motivo, created → warnings). */
function rowDetail(r: ImportRow): string {
  if (r.status === 'invalid') return (r.errors ?? []).map((e) => `${e.field}: ${e.message}`).join('; ');
  if (r.status === 'skipped') return r.skip_reason ?? '';
  return (r.warnings ?? []).map((w) => `${w.field}: ${w.outcome}`).join('; ');
}

/**
 * Unión ESTABLE de encabezados: `raw` es jsonb (no garantiza el orden original del
 * CSV), así que se recorre TODAS las filas conservando el orden en que aparece cada
 * encabezado (primero los de la 1ª fila, luego los nuevos que surjan). No se pierde
 * ninguna columna ni se promete falsamente el orden original.
 */
function unionHeaders(rows: ImportRow[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of rows) {
    for (const k of Object.keys(r.raw ?? {})) {
      if (!seen.has(k)) {
        seen.add(k);
        out.push(k);
      }
    }
  }
  return out;
}

function csvEscape(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV anotado: columnas originales del archivo + estado + detalle + animal_id. */
export function buildReportCsv(rows: ImportRow[]): string {
  const headers = unionHeaders(rows);
  const cols = [...headers, 'estado', 'detalle', 'animal_id'];
  const lines = [cols.map(csvEscape).join(',')];
  for (const r of rows) {
    const rawVals = headers.map((h) => (r.raw ?? {})[h] ?? '');
    lines.push([...rawVals, r.status, rowDetail(r), r.resulting_entity_id ?? ''].map(csvEscape).join(','));
  }
  return lines.join('\r\n');
}
