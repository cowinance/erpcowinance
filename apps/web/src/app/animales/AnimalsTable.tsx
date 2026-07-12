'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeftRight } from 'lucide-react';
import { fileUrl } from '@/lib/api';
import { EmptyState, StatusBadge } from '@/components/ui';
import { ageFrom, formatKg, relativeTime, STATUS_LABELS } from '@/lib/format';
import { Button } from '@/components/Button';
import { MoveDialog, type MoveLot } from '@/components/MoveDialog';

/**
 * Tabla del hato con SELECCIÓN MÚLTIPLE (P3 M-2.2). Los datos los sigue cargando el
 * server (SSR); este componente cliente añade checkboxes por fila, «seleccionar todos»
 * y una barra de acción flotante que abre el MoveDialog con los ids seleccionados.
 * La presentación de las filas es la misma que la lista server previa.
 */
export function AnimalsTable({ animals, lots }: { animals: any[]; lots: MoveLot[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [moving, setMoving] = useState(false);

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

  return (
    <>
      <div className="overflow-hidden rounded-[10px] border border-subtle bg-surface shadow-[var(--shadow-1)]">
        <table className="w-full text-body">
          <thead>
            <tr className="h-8 border-b border-subtle bg-sunken text-left text-caption font-medium tracking-[0.06em] text-ink-3 uppercase">
              <th className="w-9 pl-4">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  aria-label="Seleccionar todos"
                  className="align-middle accent-brand"
                />
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
              <tr
                key={a.id}
                className={`h-9 border-b border-subtle last:border-0 hover:bg-sunken ${selected.has(a.id) ? 'bg-brand-soft/40' : ''}`}
              >
                <td className="pl-4">
                  <input
                    type="checkbox"
                    checked={selected.has(a.id)}
                    onChange={() => toggle(a.id)}
                    aria-label={`Seleccionar ${a.tag ?? a.id}`}
                    className="align-middle accent-brand"
                  />
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
        <div
          className="fixed inset-x-0 bottom-6 z-40 mx-auto flex w-fit items-center gap-3 rounded-full border border-subtle bg-surface px-4 py-2 shadow-[var(--shadow-1)]"
          role="status"
          aria-live="polite"
        >
          <span className="text-body font-medium">
            {selected.size} seleccionado{selected.size === 1 ? '' : 's'}
          </span>
          <Button size="sm" onClick={() => setMoving(true)}>
            <ArrowLeftRight size={14} className="mr-1.5" /> Mover
          </Button>
          <button onClick={() => setSelected(new Set())} className="text-label text-ink-3 hover:text-ink">
            Cancelar
          </button>
        </div>
      )}

      {moving && <MoveDialog animalIds={[...selected]} lots={lots} onClose={() => setMoving(false)} onDone={() => setSelected(new Set())} />}
    </>
  );
}
