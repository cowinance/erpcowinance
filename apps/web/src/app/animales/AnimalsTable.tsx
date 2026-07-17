'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeftRight, Ban, Download, Printer, Tags } from 'lucide-react';
import { API_URL, authHeaders, fileUrl } from '@/lib/api';
import { EmptyState, StatusBadge } from '@/components/ui';
import { ageFrom, formatKg, relativeTime, STATUS_LABELS } from '@/lib/format';
import { Button } from '@/components/Button';
import { MoveDialog, type MoveLot } from '@/components/MoveDialog';
import { downloadCsv } from '@/lib/csv';

/**
 * Tabla del hato con SELECCIÓN MÚLTIPLE y ACCIONES MASIVAS (A360 E5): mover, cambiar
 * categoría, descartar/perder (ciclo de vida vía AnimalStatusService), exportar CSV e
 * imprimir. Las acciones destructivas piden confirmación. Los datos los carga el navegador.
 */
export function AnimalsTable({ animals, lots, categories = [] }: { animals: any[]; lots: MoveLot[]; categories?: any[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [moving, setMoving] = useState(false);
  const [dialog, setDialog] = useState<null | 'category' | 'cull' | 'loss'>(null);

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const allIds = animals.map((a) => a.id);
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(allIds));
  const ids = [...selected];

  const exportCsv = () => {
    const rows = animals.filter((a) => selected.has(a.id));
    downloadCsv('animales', [
      ['Caravana', 'Nombre', 'Categoría', 'Raza', 'Sexo', 'Edad', 'Lote', 'Último peso (kg)', 'GDP', 'Estado'],
      ...rows.map((a) => [
        a.tag ?? '', a.name ?? '', a.category ?? '', a.breeds ?? '', a.sex ?? '',
        ageFrom(a.birth_date), a.lot_name ?? '', a.last_weight_kg ?? '', a.adg != null ? a.adg.toFixed(2) : '', STATUS_LABELS[a.status] ?? a.status,
      ]),
    ]);
  };

  return (
    <>
      <div className="overflow-hidden rounded-[10px] border border-subtle bg-surface shadow-[var(--shadow-1)]">
        <table className="w-full text-body">
          <thead>
            <tr className="h-8 border-b border-subtle bg-sunken text-left text-caption font-medium tracking-[0.06em] text-ink-3 uppercase">
              <th className="w-9 pl-4">
                <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Seleccionar todos" className="align-middle accent-brand" />
              </th>
              <th>Caravana</th>
              <th>Nombre</th>
              <th>Categoría</th>
              <th>Raza</th>
              <th>Edad</th>
              <th>Lote</th>
              <th className="text-right">Último peso</th>
              <th className="pr-2 text-right">GDP</th>
              <th className="pr-4 text-right">Estado</th>
            </tr>
          </thead>
          <tbody>
            {animals.map((a: any) => (
              <tr key={a.id} className={`h-9 border-b border-subtle last:border-0 hover:bg-sunken ${selected.has(a.id) ? 'bg-brand-soft/40' : ''}`}>
                <td className="pl-4">
                  <input type="checkbox" checked={selected.has(a.id)} onChange={() => toggle(a.id)} aria-label={`Seleccionar ${a.tag ?? a.id}`} className="align-middle accent-brand" />
                </td>
                <td>
                  <Link href={`/animales/${a.id}`} className="inline-flex items-center gap-2 font-mono font-medium text-brand hover:underline">
                    {fileUrl(a.photo) ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={fileUrl(a.photo)!} alt="" className="size-6 rounded-full border border-subtle object-cover" />
                    ) : (
                      <span className="size-6 rounded-full border border-dashed border-strong bg-sunken" />
                    )}
                    {a.tag ?? '—'}
                  </Link>
                </td>
                <td className="text-ink-2">{a.name ?? '—'}</td>
                <td>{a.category ?? '—'}</td>
                <td className="text-ink-2">{a.breeds ?? '—'}</td>
                <td className="tnum text-ink-2">{ageFrom(a.birth_date)}</td>
                <td className="text-ink-2">{a.lot_name ?? '—'}</td>
                <td className="tnum text-right font-medium">
                  {formatKg(a.last_weight_kg)}
                  {a.last_weighed_at && <span className="ml-1.5 text-caption font-normal text-ink-3">{relativeTime(a.last_weighed_at)}</span>}
                </td>
                <td className="tnum pr-2 text-right text-ink-2">{a.adg != null ? a.adg.toFixed(2) : '—'}</td>
                <td className="pr-4 text-right">
                  <StatusBadge status={a.status} label={STATUS_LABELS[a.status] ?? a.status} />
                </td>
              </tr>
            ))}
            {!animals.length && (
              <tr>
                <td colSpan={10}>
                  <EmptyState
                    title="No hay animales con ese filtro"
                    body="Probá con otra búsqueda, o registrá tu primer animal para empezar a construir el historial del hato."
                    actionHref="/animales/nuevo"
                    actionLabel="Registrar animal"
                  />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {selected.size > 0 && (
        <div className="fixed inset-x-0 bottom-6 z-40 mx-auto flex w-fit flex-wrap items-center gap-2 rounded-full border border-subtle bg-surface px-4 py-2 shadow-[var(--shadow-1)]" role="status" aria-live="polite">
          <span className="text-body font-medium">{selected.size} seleccionado{selected.size === 1 ? '' : 's'}</span>
          <Button size="sm" onClick={() => setMoving(true)}><ArrowLeftRight size={14} className="mr-1.5" /> Mover</Button>
          {categories.length > 0 && (
            <Button size="sm" variant="secondary" onClick={() => setDialog('category')}><Tags size={14} className="mr-1.5" /> Categoría</Button>
          )}
          <Button size="sm" variant="secondary" onClick={() => setDialog('cull')}><Ban size={14} className="mr-1.5" /> Descartar</Button>
          <Button size="sm" variant="secondary" onClick={exportCsv}><Download size={14} className="mr-1.5" /> CSV</Button>
          <Button size="sm" variant="secondary" onClick={() => window.print()}><Printer size={14} className="mr-1.5" /> Imprimir</Button>
          <button onClick={() => setSelected(new Set())} className="text-label text-ink-3 hover:text-ink">Cancelar</button>
        </div>
      )}

      {moving && <MoveDialog animalIds={ids} lots={lots} onClose={() => setMoving(false)} onDone={() => setSelected(new Set())} />}
      {dialog === 'category' && (
        <CategoryDialog
          animalIds={ids}
          categories={categories}
          onClose={() => setDialog(null)}
          onDone={() => { setSelected(new Set()); router.refresh(); }}
        />
      )}
      {dialog === 'cull' && (
        <StatusDialog
          animalIds={ids}
          toStatus="culled"
          title="Descartar animales"
          verb="descartar"
          onClose={() => setDialog(null)}
          onDone={() => { setSelected(new Set()); router.refresh(); }}
        />
      )}
    </>
  );
}

function CategoryDialog({ animalIds, categories, onClose, onDone }: { animalIds: string[]; categories: any[]; onClose: () => void; onDone: () => void }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ changed: number; skipped: number } | null>(null);

  async function submit() {
    if (!code) { setError('Elegí una categoría.'); return; }
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`${API_URL}/animals/category/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ animal_ids: animalIds, category_code: code }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message?.title ?? json?.title ?? `Error ${res.status}`);
      setResult(json);
    } catch (e: any) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <Modal title="Cambiar categoría" onClose={onClose}>
      {result ? (
        <>
          <p className="text-body">{result.changed} cambiado{result.changed === 1 ? '' : 's'}{result.skipped ? `, ${result.skipped} omitido${result.skipped === 1 ? '' : 's'} (sexo/especie incompatible)` : ''}.</p>
          <div className="mt-6 flex justify-end"><Button onClick={onDone}>Listo</Button></div>
        </>
      ) : (
        <>
          <p className="mb-3 text-label text-ink-3">{animalIds.length} animales. Los de sexo o especie incompatible se omiten.</p>
          <select value={code} onChange={(e) => setCode(e.target.value)} className="h-9 w-full rounded-md border border-strong bg-surface px-2 text-body outline-none focus:ring-2 focus:ring-brand">
            <option value="">— Elegí una categoría —</option>
            {categories.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
          </select>
          {error && <p className="mt-3 text-label text-danger">{error}</p>}
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose} disabled={busy}>Cancelar</Button>
            <Button onClick={submit} loading={busy} disabled={!code}>Cambiar categoría</Button>
          </div>
        </>
      )}
    </Modal>
  );
}

function StatusDialog({ animalIds, toStatus, title, verb, onClose, onDone }: { animalIds: string[]; toStatus: string; title: string; verb: string; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ changed: number; skipped: number } | null>(null);

  async function submit() {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`${API_URL}/animals/status/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ animal_ids: animalIds, status: toStatus, reason: reason || undefined }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message?.title ?? json?.title ?? `Error ${res.status}`);
      setResult(json);
    } catch (e: any) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <Modal title={title} onClose={onClose}>
      {result ? (
        <>
          <p className="text-body">{result.changed} {verb === 'descartar' ? 'descartado' : 'procesado'}{result.changed === 1 ? '' : 's'}{result.skipped ? `, ${result.skipped} omitido${result.skipped === 1 ? '' : 's'} (no activos)` : ''}.</p>
          <div className="mt-6 flex justify-end"><Button onClick={onDone}>Listo</Button></div>
        </>
      ) : (
        <>
          <p className="mb-3 text-body text-ink-2">
            Vas a <strong>{verb}</strong> {animalIds.length} animal{animalIds.length === 1 ? '' : 'es'}. Salen del stock activo (no reciben más movimientos ni tratamientos).
          </p>
          <label className="block text-label font-medium text-ink-2">Motivo (opcional)</label>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motivo del descarte" className="mt-1 h-9 w-full rounded-md border border-strong bg-surface px-2 text-body outline-none focus:ring-2 focus:ring-brand" />
          {error && <p className="mt-3 text-label text-danger">{error}</p>}
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose} disabled={busy}>Cancelar</Button>
            <Button onClick={submit} loading={busy}>Confirmar</Button>
          </div>
        </>
      )}
    </Modal>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="w-full max-w-md rounded-[10px] border border-subtle bg-surface p-6 shadow-[var(--shadow-1)]" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-4 text-subheading font-semibold">{title}</h2>
        {children}
      </div>
    </div>
  );
}
