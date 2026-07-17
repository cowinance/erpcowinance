'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { API_URL, authHeaders } from '@/lib/api';
import { Card, CardTitle, EmptyState } from '@/components/ui';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Select } from '@/components/Select';

interface Lot { id: string; name: string; purpose: string | null; is_active: boolean; paddock_name: string | null; animal_count: number }
interface Paddock { id: string; name: string }
interface AnimalRow { id: string; tag: string | null; name: string | null; category: string | null; sex: string; lot_id: string | null; lot_name: string | null }
interface Detail extends Lot {
  current_paddock_id: string | null;
  head: number;
  avg_weight_kg: number | null;
  avg_gdp: number | null;
  by_category: { category: string; n: number }[];
  by_sex: { sex: string; n: number }[];
}

const PURPOSES: [string, string][] = [
  ['breeding', 'Cría'], ['fattening', 'Engorde'], ['dairy', 'Lechería'],
  ['weaning', 'Recría / destete'], ['quarantine', 'Cuarentena'], ['hospital', 'Hospital'],
];
const PURPOSE_ES = Object.fromEntries(PURPOSES) as Record<string, string>;
const SEX_ES: Record<string, string> = { F: 'Hembras', M: 'Machos' };

export function LotsManager({ lots, paddocks }: { lots: Lot[]; paddocks: Paddock[] }) {
  const router = useRouter();
  const [mode, setMode] = useState<'none' | 'new' | 'edit'>('none');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // form
  const [name, setName] = useState('');
  const [purpose, setPurpose] = useState('');
  const [paddockId, setPaddockId] = useState('');
  const [active, setActive] = useState(true);
  // animales del lote + selección + agregado
  const [animals, setAnimals] = useState<AnimalRow[]>([]);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [moveTarget, setMoveTarget] = useState('');
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<AnimalRow[]>([]);
  const [addSel, setAddSel] = useState<Set<string>>(new Set());

  async function call(method: string, path: string, body?: any): Promise<any | null> {
    setBusy(true); setError('');
    try {
      const res = await fetch(`${API_URL}${path}`, { method, headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: body ? JSON.stringify(body) : undefined });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.title ?? json?.message?.title ?? `Error ${res.status}`);
      return json;
    } catch (e: any) { setError(e.message ?? 'Error'); return null; }
    finally { setBusy(false); }
  }

  async function loadAnimals(lotId: string) {
    const r = await call('GET', `/animals?lot=${lotId}&status=active&limit=300`);
    setAnimals((r?.data ?? []) as AnimalRow[]);
    setSel(new Set());
  }
  async function open(id: string) {
    setSelectedId(id); setMode('none'); setError(''); setAdding(false); setResults([]); setSearch('');
    const d = await call('GET', `/lots/${id}`);
    if (d) { setDetail(d); loadAnimals(id); }
  }
  function toggle(set: Set<string>, id: string): Set<string> {
    const next = new Set(set);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  }
  /** Mueve los animales seleccionados a `target` (id de lote) o los quita (null). Reusa POST /movements. */
  async function moveSelected(target: string | null) {
    if (!selectedId || sel.size === 0) return;
    const r = await call('POST', '/movements', { animal_ids: [...sel], lot_id: target, reason: target ? 'reasignación de lote' : 'salida de lote' });
    if (r) { setMoveTarget(''); router.refresh(); const d = await call('GET', `/lots/${selectedId}`); if (d) setDetail(d); loadAnimals(selectedId); }
  }
  async function runSearch(q: string) {
    setSearch(q);
    const r = await call('GET', `/animals?status=active&limit=40${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ''}`);
    setResults(((r?.data ?? []) as AnimalRow[]).filter((a) => a.lot_id !== selectedId));
  }
  async function addSelected() {
    if (!selectedId || addSel.size === 0) return;
    const r = await call('POST', '/movements', { animal_ids: [...addSel], lot_id: selectedId, reason: 'ingreso al lote' });
    if (r) { setAdding(false); setAddSel(new Set()); setResults([]); setSearch(''); router.refresh(); const d = await call('GET', `/lots/${selectedId}`); if (d) setDetail(d); loadAnimals(selectedId); }
  }
  function startNew() { setMode('new'); setSelectedId(null); setDetail(null); setName(''); setPurpose(''); setError(''); }
  function startEdit() {
    if (!detail) return;
    setName(detail.name); setPurpose(detail.purpose ?? ''); setPaddockId(detail.current_paddock_id ?? ''); setActive(detail.is_active);
    setMode('edit');
  }
  async function createLot() {
    const r = await call('POST', '/lots', { name, purpose: purpose || undefined });
    if (r) { setMode('none'); router.refresh(); open(r.id); }
  }
  async function saveEdit() {
    if (!selectedId) return;
    const r = await call('PUT', `/lots/${selectedId}`, { name, purpose: purpose || null, current_paddock_id: paddockId || null, is_active: active });
    if (r) { setDetail(r); setMode('none'); router.refresh(); }
  }
  async function archive() {
    if (!selectedId) return;
    const r = await call('DELETE', `/lots/${selectedId}`);
    if (r) { setSelectedId(null); setDetail(null); router.refresh(); }
  }

  return (
    <div className="grid grid-cols-3 gap-4 max-lg:grid-cols-1">
      {/* Lista */}
      <div className="col-span-2 space-y-3 max-lg:col-span-1">
        <div className="flex justify-end">
          <Button size="sm" onClick={startNew}>+ Nuevo lote</Button>
        </div>
        {lots.length === 0 ? (
          <EmptyState title="Sin lotes todavía" body="Creá el primer rodeo o grupo de manejo de tu finca." />
        ) : (
          <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
            {lots.map((l) => (
              <button key={l.id} onClick={() => open(l.id)} className={`rounded-[10px] border bg-surface p-4 text-left shadow-[var(--shadow-1)] transition-colors ${selectedId === l.id ? 'border-brand' : 'border-subtle hover:border-strong'} ${l.is_active ? '' : 'opacity-60'}`}>
                <div className="flex items-center justify-between">
                  <span className="text-body font-semibold">{l.name}</span>
                  {!l.is_active && <span className="rounded bg-sunken px-1.5 py-0.5 text-caption text-ink-3">Archivado</span>}
                </div>
                <div className="mt-0.5 text-label text-ink-3">{PURPOSE_ES[l.purpose ?? ''] ?? l.purpose ?? 'sin propósito'} · {l.paddock_name ?? 'sin potrero'}</div>
                <div className="tnum mt-2 text-compat-22 font-semibold">{l.animal_count}<span className="ml-1 text-body font-normal text-ink-2">animales</span></div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Panel: nuevo / editar / detalle */}
      <div className="self-start rounded-[10px] border border-subtle bg-surface p-5 shadow-[var(--shadow-1)]">
        {error && <p role="alert" className="mb-2 text-label text-danger">{error}</p>}

        {mode === 'new' ? (
          <div>
            <CardTitle>Nuevo lote</CardTitle>
            <div className="space-y-2">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre del lote" aria-label="Nombre" />
              <Select value={purpose} onChange={(e) => setPurpose(e.target.value)} aria-label="Propósito">
                <option value="">Propósito (opcional)</option>
                {PURPOSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
              <div className="flex gap-2">
                <Button size="sm" fullWidth loading={busy} disabled={busy || !name.trim()} onClick={createLot}>Crear lote</Button>
                <Button size="sm" variant="secondary" onClick={() => setMode('none')}>Cancelar</Button>
              </div>
            </div>
          </div>
        ) : mode === 'edit' && detail ? (
          <div>
            <CardTitle>Editar lote</CardTitle>
            <div className="space-y-2">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre" aria-label="Nombre" />
              <Select value={purpose} onChange={(e) => setPurpose(e.target.value)} aria-label="Propósito">
                <option value="">Sin propósito</option>
                {PURPOSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
              <Select value={paddockId} onChange={(e) => setPaddockId(e.target.value)} aria-label="Potrero">
                <option value="">Sin potrero</option>
                {paddocks.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
              <label className="flex items-center gap-2 text-body text-ink-2">
                <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Activo
              </label>
              <div className="flex gap-2">
                <Button size="sm" fullWidth loading={busy} disabled={busy || !name.trim()} onClick={saveEdit}>Guardar</Button>
                <Button size="sm" variant="secondary" onClick={() => setMode('none')}>Cancelar</Button>
              </div>
            </div>
          </div>
        ) : detail ? (
          <div>
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-compat-16 font-semibold">{detail.name}</h2>
                <p className="mt-0.5 text-label text-ink-3">{PURPOSE_ES[detail.purpose ?? ''] ?? detail.purpose ?? 'sin propósito'} · {detail.paddock_name ?? 'sin potrero'}{detail.is_active ? '' : ' · archivado'}</p>
              </div>
              <div className="flex gap-1">
                <Button size="sm" variant="secondary" onClick={startEdit}>Editar</Button>
                <Button size="sm" variant="secondary" onClick={archive} disabled={busy} aria-label="Archivar lote">✕</Button>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-3">
              <div className="rounded-md bg-sunken p-3"><div className="text-caption text-ink-3">Cabezas</div><div className="tnum text-compat-22 font-semibold">{detail.head}</div></div>
              <div className="rounded-md bg-sunken p-3"><div className="text-caption text-ink-3">Peso prom.</div><div className="tnum text-compat-22 font-semibold">{detail.avg_weight_kg ?? '—'}<span className="ml-0.5 text-caption font-normal text-ink-3">kg</span></div></div>
              <div className="rounded-md bg-sunken p-3"><div className="text-caption text-ink-3">GDP</div><div className="tnum text-compat-22 font-semibold">{detail.avg_gdp ?? '—'}</div></div>
            </div>

            {detail.head > 0 && (
              <>
                <div className="mt-4">
                  <div className="mb-1.5 text-caption font-medium tracking-[0.06em] text-ink-3 uppercase">Composición por categoría</div>
                  <div className="space-y-1">
                    {detail.by_category.map((c) => (
                      <div key={c.category} className="flex items-center gap-2">
                        <span className="w-28 shrink-0 text-label text-ink-2">{c.category}</span>
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-sunken">
                          <div className="h-full rounded-full bg-brand" style={{ width: `${(c.n / detail.head) * 100}%` }} />
                        </div>
                        <span className="tnum w-8 text-right text-label text-ink-3">{c.n}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="mt-3 flex gap-4 text-label text-ink-2">
                  {detail.by_sex.map((s) => <span key={s.sex}>{SEX_ES[s.sex] ?? s.sex}: <span className="tnum font-medium">{s.n}</span></span>)}
                </div>
              </>
            )}

            {/* Animales del lote: selección + mover/quitar + agregar */}
            <div className="mt-5 border-t border-subtle pt-4">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-caption font-medium tracking-[0.06em] text-ink-3 uppercase">Animales ({animals.length})</span>
                <button onClick={() => { setAdding((v) => !v); setResults([]); setSearch(''); setAddSel(new Set()); }} className="text-label font-medium text-brand hover:underline">
                  {adding ? 'Cerrar' : '+ Agregar'}
                </button>
              </div>

              {adding && (
                <div className="mb-3 rounded-md border border-subtle bg-sunken p-2">
                  <Input value={search} onChange={(e) => runSearch(e.target.value)} placeholder="Buscar animales por caravana o nombre…" aria-label="Buscar animales" />
                  <div className="mt-2 max-h-48 space-y-0.5 overflow-y-auto">
                    {results.length === 0 ? (
                      <p className="py-2 text-center text-caption text-ink-3">{search ? 'Sin resultados fuera de este lote.' : 'Escribí para buscar animales.'}</p>
                    ) : results.map((a) => (
                      <label key={a.id} className="flex items-center gap-2 rounded px-1.5 py-1 text-label hover:bg-surface">
                        <input type="checkbox" checked={addSel.has(a.id)} onChange={() => setAddSel((s) => toggle(s, a.id))} />
                        <span className="font-medium">{a.tag ?? a.name ?? a.id.slice(0, 6)}</span>
                        <span className="text-ink-3">{a.category ?? ''}{a.lot_name ? ` · ${a.lot_name}` : ' · sin lote'}</span>
                      </label>
                    ))}
                  </div>
                  {addSel.size > 0 && <Button size="sm" fullWidth className="mt-2" loading={busy} onClick={addSelected}>Agregar {addSel.size} al lote</Button>}
                </div>
              )}

              {animals.length === 0 ? (
                <p className="text-body text-ink-3">Sin animales en el lote.</p>
              ) : (
                <>
                  <div className="max-h-56 space-y-0.5 overflow-y-auto">
                    {animals.map((a) => (
                      <label key={a.id} className="flex items-center gap-2 rounded px-1.5 py-1 text-label hover:bg-sunken">
                        <input type="checkbox" checked={sel.has(a.id)} onChange={() => setSel((s) => toggle(s, a.id))} />
                        <span className="font-medium">{a.tag ?? a.name ?? a.id.slice(0, 6)}</span>
                        <span className="text-ink-3">{a.category ?? ''} · {SEX_ES[a.sex] ?? a.sex}</span>
                      </label>
                    ))}
                  </div>
                  {sel.size > 0 && (
                    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md bg-sunken p-2">
                      <span className="text-label font-medium text-ink-2">{sel.size} seleccionados</span>
                      <Select value={moveTarget} onChange={(e) => setMoveTarget(e.target.value)} aria-label="Lote destino" controlSize="sm" fullWidth={false} className="min-w-0 flex-1">
                        <option value="">Mover a…</option>
                        {lots.filter((l) => l.id !== detail.id && l.is_active).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                      </Select>
                      <Button size="sm" disabled={!moveTarget || busy} onClick={() => moveSelected(moveTarget)}>Mover</Button>
                      <Button size="sm" variant="secondary" disabled={busy} onClick={() => moveSelected(null)}>Quitar</Button>
                    </div>
                  )}
                </>
              )}
            </div>

            <Link href={`/animales?lot=${detail.id}`} className="mt-4 inline-block text-label font-medium text-brand hover:underline">Ver animales del lote →</Link>
          </div>
        ) : (
          <div className="py-10 text-center">
            <p className="text-body text-ink-2">Elegí un lote para ver su composición, o creá uno nuevo.</p>
          </div>
        )}
      </div>
    </div>
  );
}
