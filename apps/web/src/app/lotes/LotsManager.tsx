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
interface Category { code: string; name: string }
interface AnimalFilters { q: string; category: string; sex: string; minWeight: string; maxWeight: string; minAge: string; maxAge: string }
const EMPTY_FILTERS: AnimalFilters = { q: '', category: '', sex: '', minWeight: '', maxWeight: '', minAge: '', maxAge: '' };
interface AnimalRow { id: string; tag: string | null; name: string | null; category: string | null; sex: string; lot_id: string | null; lot_name: string | null; last_weight_kg: number | null; birth_date: string | null }
interface HistoryEvent { movement_id: string; moved_at: string; kind: 'ingreso' | 'salida' | 'rotacion' | 'movimiento'; animals: number; reason: string | null; actor: string | null; from_lot: string | null; to_lot: string | null; from_paddock: string | null; to_paddock: string | null }
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
const HIST_LABEL: Record<string, string> = { ingreso: 'Ingreso', salida: 'Salida', rotacion: 'Rotación de potrero', movimiento: 'Movimiento' };
const HIST_TONE: Record<string, string> = { ingreso: 'bg-success', salida: 'bg-warning', rotacion: 'bg-info', movimiento: 'bg-ink-3' };

// Métricas por propósito del lote (Etapa 4): qué campos mostrar y su etiqueta/unidad.
const METRIC_CONFIG: Record<string, { key: string; label: string; unit?: string }[]> = {
  fattening: [
    { key: 'kg_gained', label: 'Kg ganados', unit: 'kg' }, { key: 'conversion', label: 'Conversión', unit: 'kg/kg' }, { key: 'cost_per_kg_gained', label: 'Costo/kg' },
    { key: 'avg_adg', label: 'GDP', unit: 'kg/d' }, { key: 'feed_kg', label: 'Alimento', unit: 'kg' }, { key: 'days_to_finish', label: 'Días a terminar', unit: 'd' },
  ],
  breeding: [
    { key: 'vientres', label: 'Vientres' }, { key: 'toros', label: 'Toros' }, { key: 'prenadas', label: 'Preñadas' },
    { key: 'vacias', label: 'Vacías' }, { key: 'crias_al_pie', label: 'Crías al pie' },
  ],
  weaning: [
    { key: 'peso_inicial', label: 'Peso inicial', unit: 'kg' }, { key: 'peso_actual', label: 'Peso actual', unit: 'kg' }, { key: 'gdp', label: 'GDP', unit: 'kg/d' }, { key: 'edad_prom_meses', label: 'Edad prom.', unit: 'm' },
  ],
  hospital: [
    { key: 'dias_promedio', label: 'Días prom. en lote', unit: 'd' }, { key: 'tratamientos_vigentes', label: 'Tratam. vigentes' },
  ],
  quarantine: [
    { key: 'fecha_ingreso', label: 'Ingreso' }, { key: 'dias', label: 'Días', unit: 'd' }, { key: 'fecha_liberacion', label: 'Liberación est.' },
  ],
  dairy: [
    { key: 'litros_prom_dia', label: 'Litros/día', unit: 'l' }, { key: 'en_ordene', label: 'En ordeñe' }, { key: 'prenadas', label: 'Preñadas' },
  ],
};
const PURPOSE_METRIC_TITLE: Record<string, string> = {
  fattening: 'Métricas de engorde', breeding: 'Métricas de cría', weaning: 'Métricas de recría',
  hospital: 'Métricas de hospital', quarantine: 'Métricas de cuarentena', dairy: 'Métricas del tambo',
};
const fmtMetric = (v: any): string => {
  if (v == null) return '—';
  if (typeof v === 'string') return v.slice(0, 10); // fechas AAAA-MM-DD
  return Number(v).toLocaleString('es-AR', { maximumFractionDigits: 2 });
};

export function LotsManager({ lots, paddocks, categories }: { lots: Lot[]; paddocks: Paddock[]; categories: Category[] }) {
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
  // animales del lote + selección + agregado + filtros/paginación
  const [animals, setAnimals] = useState<AnimalRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [filters, setFilters] = useState<AnimalFilters>(EMPTY_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [moveTarget, setMoveTarget] = useState('');
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<AnimalRow[]>([]);
  const [addSel, setAddSel] = useState<Set<string>>(new Set());
  // historial del lote
  const [history, setHistory] = useState<HistoryEvent[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  // métricas por propósito
  const [metrics, setMetrics] = useState<{ purpose: string | null; metrics: Record<string, any> | null } | null>(null);
  // acciones del lote: dividir / mover todo / fusionar
  const [actionsOpen, setActionsOpen] = useState(false);
  const [splitName, setSplitName] = useState('');
  const [moveAllTarget, setMoveAllTarget] = useState('');
  const [mergeTarget, setMergeTarget] = useState('');
  const [confirmMerge, setConfirmMerge] = useState(false);

  async function call(method: string, path: string, body?: any): Promise<any | null> {
    setBusy(true); setError('');
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json', ...authHeaders() };
      // Idempotencia: los movimientos llevan una clave por acción para no duplicar por doble clic/reintento.
      if (method === 'POST' && (path.startsWith('/movements') || path.includes('/rotate'))) headers['Idempotency-Key'] = crypto.randomUUID();
      const res = await fetch(`${API_URL}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.title ?? json?.message?.title ?? `Error ${res.status}`);
      return json;
    } catch (e: any) { setError(e.message ?? 'Error'); return null; }
    finally { setBusy(false); }
  }

  function filterQuery(f: AnimalFilters): string {
    const p = new URLSearchParams({ status: 'active', limit: '40' });
    if (f.q.trim()) p.set('q', f.q.trim());
    if (f.category) p.set('category', f.category);
    if (f.sex) p.set('sex', f.sex);
    if (f.minWeight) p.set('min_weight', f.minWeight);
    if (f.maxWeight) p.set('max_weight', f.maxWeight);
    if (f.minAge) p.set('min_age', f.minAge);
    if (f.maxAge) p.set('max_age', f.maxAge);
    return p.toString();
  }
  /** Carga (o pagina) los animales del lote con los filtros actuales. `reset` reemplaza; si no, agrega. */
  async function loadAnimals(lotId: string, f: AnimalFilters, next?: string | null) {
    const q = filterQuery(f) + (next ? `&cursor=${next}` : '');
    const r = await call('GET', `/animals?lot=${lotId}&${q}`);
    const page = (r?.data ?? []) as AnimalRow[];
    setAnimals((prev) => (next ? [...prev, ...page] : page));
    setCursor(r?.next_cursor ?? null);
    if (!next) setSel(new Set());
  }
  function applyFilters(f: AnimalFilters) {
    setFilters(f);
    if (selectedId) loadAnimals(selectedId, f, null);
  }
  async function open(id: string) {
    setSelectedId(id); setMode('none'); setError(''); setAdding(false); setResults([]); setSearch(''); setShowHistory(false);
    setFilters(EMPTY_FILTERS); setFiltersOpen(false);
    setActionsOpen(false); setSplitName(''); setMoveAllTarget(''); setMergeTarget(''); setConfirmMerge(false);
    setMetrics(null);
    const d = await call('GET', `/lots/${id}`);
    if (d) {
      setDetail(d);
      loadAnimals(id, EMPTY_FILTERS, null);
      call('GET', `/lots/${id}/history`).then((h) => setHistory((h ?? []) as HistoryEvent[]));
      call('GET', `/lots/${id}/metrics`).then((m) => setMetrics(m ?? null));
    }
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
    if (r) { setMoveTarget(''); router.refresh(); const d = await call('GET', `/lots/${selectedId}`); if (d) setDetail(d); loadAnimals(selectedId, filters, null); }
  }
  async function runSearch(q: string) {
    setSearch(q);
    const r = await call('GET', `/animals?status=active&limit=40${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ''}`);
    setResults(((r?.data ?? []) as AnimalRow[]).filter((a) => a.lot_id !== selectedId));
  }
  async function addSelected() {
    if (!selectedId || addSel.size === 0) return;
    const r = await call('POST', '/movements', { animal_ids: [...addSel], lot_id: selectedId, reason: 'ingreso al lote' });
    if (r) { setAdding(false); setAddSel(new Set()); setResults([]); setSearch(''); router.refresh(); const d = await call('GET', `/lots/${selectedId}`); if (d) setDetail(d); loadAnimals(selectedId, filters, null); }
  }
  async function refreshDetail() {
    if (!selectedId) return;
    router.refresh();
    const d = await call('GET', `/lots/${selectedId}`); if (d) setDetail(d);
    loadAnimals(selectedId, filters, null);
    call('GET', `/lots/${selectedId}/history`).then((h) => setHistory((h ?? []) as HistoryEvent[]));
  }
  /** Dividir: crea un lote nuevo con los animales seleccionados. */
  async function doSplit() {
    if (!selectedId || sel.size === 0 || !splitName.trim()) return;
    const r = await call('POST', `/lots/${selectedId}/split`, { name: splitName, animal_ids: [...sel] });
    if (r) { setSplitName(''); setActionsOpen(false); refreshDetail(); }
  }
  /** Mover todo el rodeo a otro lote. */
  async function doMoveAll() {
    if (!selectedId || !moveAllTarget) return;
    const r = await call('POST', `/lots/${selectedId}/move-all`, { target_lot_id: moveAllTarget });
    if (r) { setMoveAllTarget(''); setActionsOpen(false); refreshDetail(); }
  }
  /** Fusionar este lote en otro (mueve todo + archiva este). Requiere confirmación (acción destructiva). */
  async function doMerge() {
    if (!selectedId || !mergeTarget) return;
    const r = await call('POST', `/lots/${selectedId}/merge`, { target_lot_id: mergeTarget });
    if (r) { setSelectedId(null); setDetail(null); setConfirmMerge(false); setActionsOpen(false); router.refresh(); }
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
    if (!selectedId || !detail) return;
    const r = await call('PUT', `/lots/${selectedId}`, { name, purpose: purpose || null, is_active: active });
    if (!r) return;
    // Cambiar el potrero NO es editar un campo: es una ROTACIÓN del lote (los animales lo siguen).
    if (paddockId && paddockId !== detail.current_paddock_id) {
      const rot = await call('POST', `/lots/${selectedId}/rotate`, { paddock_id: paddockId });
      if (!rot) return;
    }
    setMode('none'); router.refresh(); open(selectedId);
  }
  async function archive() {
    if (!selectedId) return;
    const r = await call('DELETE', `/lots/${selectedId}`);
    if (r) { setSelectedId(null); setDetail(null); router.refresh(); }
  }

  const activeFilterCount = Object.entries(filters).filter(([k, v]) => k !== 'q' && v).length;

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
              <div>
                <Select value={paddockId} onChange={(e) => setPaddockId(e.target.value)} aria-label="Potrero">
                  <option value="">Sin potrero</option>
                  {paddocks.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </Select>
                <p className="mt-1 text-caption text-ink-3">Cambiar el potrero rota el lote completo: los animales lo siguen y queda registrado.</p>
              </div>
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
                <Button size="sm" variant={actionsOpen ? 'primary' : 'secondary'} onClick={() => setActionsOpen((v) => !v)}>Acciones</Button>
                <Button size="sm" variant="secondary" onClick={startEdit}>Editar</Button>
                <Button size="sm" variant="secondary" onClick={archive} disabled={busy} aria-label="Archivar lote">✕</Button>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-3">
              <div className="rounded-md bg-sunken p-3"><div className="text-caption text-ink-3">Cabezas</div><div className="tnum text-compat-22 font-semibold">{detail.head}</div></div>
              <div className="rounded-md bg-sunken p-3"><div className="text-caption text-ink-3">Peso prom.</div><div className="tnum text-compat-22 font-semibold">{detail.avg_weight_kg ?? '—'}<span className="ml-0.5 text-caption font-normal text-ink-3">kg</span></div></div>
              <div className="rounded-md bg-sunken p-3"><div className="text-caption text-ink-3">GDP</div><div className="tnum text-compat-22 font-semibold">{detail.avg_gdp ?? '—'}</div></div>
            </div>

            {/* Acciones del lote: dividir, mover todo, fusionar */}
            {actionsOpen && (
              <div className="mt-3 space-y-3 rounded-md border border-subtle bg-sunken p-3">
                <div>
                  <div className="mb-1 text-caption font-medium tracking-[0.06em] text-ink-3 uppercase">Dividir en un lote nuevo</div>
                  <div className="flex gap-1.5">
                    <Input value={splitName} onChange={(e) => setSplitName(e.target.value)} placeholder="Nombre del lote nuevo" aria-label="Nombre del lote nuevo" />
                    <Button size="sm" disabled={busy || sel.size === 0 || !splitName.trim()} onClick={doSplit} className="shrink-0">Dividir ({sel.size})</Button>
                  </div>
                  <p className="mt-1 text-caption text-ink-3">Marcá animales en la lista de abajo y creá un lote nuevo con ellos.</p>
                </div>

                <div>
                  <div className="mb-1 text-caption font-medium tracking-[0.06em] text-ink-3 uppercase">Mover todo el rodeo</div>
                  <div className="flex gap-1.5">
                    <Select value={moveAllTarget} onChange={(e) => setMoveAllTarget(e.target.value)} aria-label="Mover todo a" controlSize="sm" fullWidth={false} className="min-w-0 flex-1">
                      <option value="">Mover todo a…</option>
                      {lots.filter((l) => l.id !== detail.id && l.is_active).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                    </Select>
                    <Button size="sm" disabled={busy || !moveAllTarget} onClick={doMoveAll} className="shrink-0">Mover todo</Button>
                  </div>
                </div>

                <div>
                  <div className="mb-1 text-caption font-medium tracking-[0.06em] text-ink-3 uppercase">Fusionar (archiva este lote)</div>
                  <div className="flex gap-1.5">
                    <Select value={mergeTarget} onChange={(e) => { setMergeTarget(e.target.value); setConfirmMerge(false); }} aria-label="Fusionar en" controlSize="sm" fullWidth={false} className="min-w-0 flex-1">
                      <option value="">Fusionar en…</option>
                      {lots.filter((l) => l.id !== detail.id && l.is_active).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                    </Select>
                    {confirmMerge ? (
                      <Button size="sm" variant="secondary" disabled={busy} onClick={doMerge} className="shrink-0 border-danger text-danger">Confirmar</Button>
                    ) : (
                      <Button size="sm" variant="secondary" disabled={busy || !mergeTarget} onClick={() => setConfirmMerge(true)} className="shrink-0">Fusionar</Button>
                    )}
                  </div>
                  {confirmMerge && <p className="mt-1 text-caption text-warning">Se moverán todos los animales al lote elegido y este lote se archivará.</p>}
                </div>
              </div>
            )}

            {metrics?.metrics && METRIC_CONFIG[metrics.purpose ?? ''] && (
              <div className="mt-4">
                <div className="mb-1.5 text-caption font-medium tracking-[0.06em] text-ink-3 uppercase">{PURPOSE_METRIC_TITLE[metrics.purpose ?? ''] ?? 'Métricas'}</div>
                <div className="grid grid-cols-3 gap-2 max-sm:grid-cols-2">
                  {METRIC_CONFIG[metrics.purpose ?? ''].map((m) => (
                    <div key={m.key} className="rounded-md bg-sunken p-2">
                      <div className="text-caption text-ink-3">{m.label}</div>
                      <div className="tnum text-body font-semibold">
                        {fmtMetric(metrics.metrics![m.key])}
                        {m.unit && metrics.metrics![m.key] != null ? <span className="ml-0.5 text-caption font-normal text-ink-3">{m.unit}</span> : null}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

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

              {/* Filtros de la lista de animales del lote */}
              <div className="mb-2 space-y-1.5">
                <div className="flex gap-1.5">
                  <Input value={filters.q} onChange={(e) => applyFilters({ ...filters, q: e.target.value })} placeholder="Caravana o nombre…" aria-label="Buscar en el lote" />
                  <button
                    onClick={() => setFiltersOpen((v) => !v)}
                    className={`shrink-0 rounded-md border px-2.5 text-label font-medium ${activeFilterCount ? 'border-brand text-brand' : 'border-subtle text-ink-2'}`}
                  >
                    Filtros{activeFilterCount ? ` (${activeFilterCount})` : ''}
                  </button>
                </div>
                {filtersOpen && (
                  <div className="space-y-1.5 rounded-md border border-subtle bg-sunken p-2">
                    <div className="grid grid-cols-2 gap-1.5">
                      <Select value={filters.category} onChange={(e) => applyFilters({ ...filters, category: e.target.value })} aria-label="Categoría">
                        <option value="">Categoría</option>
                        {categories.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
                      </Select>
                      <Select value={filters.sex} onChange={(e) => applyFilters({ ...filters, sex: e.target.value })} aria-label="Sexo">
                        <option value="">Sexo</option>
                        <option value="F">Hembras</option>
                        <option value="M">Machos</option>
                      </Select>
                      <Input type="number" value={filters.minWeight} onChange={(e) => applyFilters({ ...filters, minWeight: e.target.value })} placeholder="Peso ≥ kg" aria-label="Peso mínimo" />
                      <Input type="number" value={filters.maxWeight} onChange={(e) => applyFilters({ ...filters, maxWeight: e.target.value })} placeholder="Peso ≤ kg" aria-label="Peso máximo" />
                      <Input type="number" value={filters.minAge} onChange={(e) => applyFilters({ ...filters, minAge: e.target.value })} placeholder="Edad ≥ meses" aria-label="Edad mínima" />
                      <Input type="number" value={filters.maxAge} onChange={(e) => applyFilters({ ...filters, maxAge: e.target.value })} placeholder="Edad ≤ meses" aria-label="Edad máxima" />
                    </div>
                    {activeFilterCount > 0 && <button onClick={() => applyFilters(EMPTY_FILTERS)} className="text-label text-brand hover:underline">Limpiar filtros</button>}
                  </div>
                )}
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
                <p className="text-body text-ink-3">{activeFilterCount || filters.q ? 'Sin animales con esos filtros.' : 'Sin animales en el lote.'}</p>
              ) : (
                <>
                  <div className="max-h-56 space-y-0.5 overflow-y-auto">
                    {animals.map((a) => (
                      <label key={a.id} className="flex items-center gap-2 rounded px-1.5 py-1 text-label hover:bg-sunken">
                        <input type="checkbox" checked={sel.has(a.id)} onChange={() => setSel((s) => toggle(s, a.id))} />
                        <span className="font-medium">{a.tag ?? a.name ?? a.id.slice(0, 6)}</span>
                        <span className="text-ink-3">{a.category ?? ''} · {SEX_ES[a.sex] ?? a.sex}{a.last_weight_kg != null ? ` · ${a.last_weight_kg} kg` : ''}</span>
                      </label>
                    ))}
                  </div>
                  {cursor && (
                    <button onClick={() => selectedId && loadAnimals(selectedId, filters, cursor)} disabled={busy} className="mt-1.5 w-full rounded-md border border-subtle py-1 text-label font-medium text-ink-2 hover:bg-sunken">
                      Cargar más
                    </button>
                  )}
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

            {/* Historial / timeline del lote (movimientos reales) */}
            <div className="mt-5 border-t border-subtle pt-4">
              <button onClick={() => setShowHistory((v) => !v)} className="mb-1.5 flex w-full items-center justify-between text-caption font-medium tracking-[0.06em] text-ink-3 uppercase">
                <span>Historial ({history.length})</span>
                <span className="text-brand">{showHistory ? 'Ocultar' : 'Ver'}</span>
              </button>
              {showHistory && (
                history.length === 0 ? (
                  <p className="text-body text-ink-3">Sin movimientos registrados.</p>
                ) : (
                  <ul className="max-h-64 space-y-2 overflow-y-auto">
                    {history.map((h) => (
                      <li key={h.movement_id} className="flex gap-2 text-label">
                        <span className={`mt-1 size-2 shrink-0 rounded-full ${HIST_TONE[h.kind]}`} />
                        <div className="min-w-0 flex-1">
                          <div className="font-medium text-ink-1">
                            {HIST_LABEL[h.kind]} · {h.animals} {h.animals === 1 ? 'animal' : 'animales'}
                          </div>
                          <div className="text-ink-3">
                            {h.kind === 'rotacion' ? `${h.from_paddock ?? '—'} → ${h.to_paddock ?? '—'}`
                              : h.kind === 'ingreso' ? `desde ${h.from_lot ?? h.from_paddock ?? 'sin lote'}`
                              : h.kind === 'salida' ? `hacia ${h.to_lot ?? h.to_paddock ?? 'sin lote'}` : ''}
                            {h.reason ? ` · ${h.reason}` : ''}
                          </div>
                          <div className="text-caption text-ink-3">{String(h.moved_at).slice(0, 10)}{h.actor ? ` · ${h.actor}` : ''}</div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )
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
