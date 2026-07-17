'use client';

/**
 * Editor de mapas de la finca (D3 · Mapas y GPS). Sobre un canvas SVG esquemático (offline, sin tiles),
 * permite VER los potreros (relleno por ocupación/carga), DIBUJAR uno nuevo (click para agregar
 * vértices), EDITAR su forma (arrastrar vértices, insertar/borrar) y editar propiedades / borrar. La
 * superficie se mide en vivo por shoelace (misma escala que el dominio: 1 unidad = 3 m). En producción
 * el mismo `boundary` es PostGIS geography sobre tiles reales.
 */
import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { API_URL, authHeaders } from '@/lib/api';
import { MoveRight, MapPin, Pencil, Plus, Trash2, Check, X, Undo2 } from 'lucide-react';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Select } from '@/components/Select';

interface Paddock {
  id: string;
  name: string;
  boundary: { type: string; coordinates: number[][][] } | null;
  area_ha: number | null;
  pasture_type: string | null;
  animal_count: number;
  stocking_rate: number | null;
  lots: { id: string; name: string; purpose: string | null; animal_count: number }[];
}

type Metric = 'cabezas' | 'carga';
type Mode = 'view' | 'draw' | 'edit';
const METERS_PER_UNIT = 3;
const PASTURES = ['natural', 'alfalfa', 'raigrás', 'feedlot', 'otra'];

function fillFor(value: number, max: number): string {
  if (value <= 0) return 'var(--bg-sunken)';
  const t = Math.min(1, value / (max || 1));
  if (t < 0.35) return 'rgba(127, 191, 163, 0.45)';
  if (t < 0.7) return 'rgba(46, 125, 91, 0.55)';
  return 'rgba(217, 123, 43, 0.55)';
}
function centroid(pts: number[][]): [number, number] {
  const n = pts.length || 1;
  return [pts.reduce((s, p) => s + p[0], 0) / n, pts.reduce((s, p) => s + p[1], 0) / n];
}
function pathOf(pts: number[][]): string {
  return pts.map((pt, i) => `${i === 0 ? 'M' : 'L'}${pt[0]},${pt[1]}`).join(' ') + ' Z';
}
/** Superficie en ha (shoelace + escala del canvas). Espejo de `polygonAreaHa` del dominio. */
function areaHa(ring: number[][]): number {
  if (ring.length < 3) return 0;
  let acc = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    acc += x1 * y2 - x2 * y1;
  }
  return Math.round((Math.abs(acc) / 2) * METERS_PER_UNIT * METERS_PER_UNIT / 10000 * 100) / 100;
}

const PURPOSE: Record<string, string> = { breeding: 'Cría', fattening: 'Engorde', dairy: 'Lechería', weaning: 'Recría', quarantine: 'Cuarentena', hospital: 'Hospital' };

export function FarmMap({ paddocks, lots }: { paddocks: Paddock[]; lots: any[] }) {
  const router = useRouter();
  const svgRef = useRef<SVGSVGElement>(null);
  const [mode, setMode] = useState<Mode>('view');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [metric, setMetric] = useState<Metric>('cabezas');
  const [moveLotId, setMoveLotId] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  // Dibujo de un potrero nuevo
  const [draft, setDraft] = useState<number[][]>([]);
  const [newName, setNewName] = useState('');
  const [newPasture, setNewPasture] = useState('natural');
  // Edición de la forma de un potrero existente
  const [editRing, setEditRing] = useState<number[][]>([]);
  const dragIdx = useRef<number | null>(null);

  const selected = paddocks.find((p) => p.id === selectedId) ?? null;
  const valueOf = (p: Paddock) => (metric === 'cabezas' ? p.animal_count : p.stocking_rate ?? 0);
  const max = useMemo(() => Math.max(...paddocks.map(valueOf), 0.001), [paddocks, metric]);
  const movableLots = lots.filter((l) => selected && !selected.lots.some((sl) => sl.id === l.id));

  function toSvg(clientX: number, clientY: number): [number, number] {
    const r = svgRef.current!.getBoundingClientRect();
    const x = Math.round(Math.max(0, Math.min(1000, ((clientX - r.left) / r.width) * 1000)));
    const y = Math.round(Math.max(0, Math.min(700, ((clientY - r.top) / r.height) * 700)));
    return [x, y];
  }

  async function call(method: string, path: string, body?: any): Promise<any | null> {
    setBusy(true);
    setMsg('');
    try {
      const res = await fetch(`${API_URL}${path}`, { method, headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: body ? JSON.stringify(body) : undefined });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.title ?? json?.message?.title ?? `Error ${res.status}`);
      router.refresh();
      return json;
    } catch (e: any) {
      setMsg(e.message ?? 'Error');
      return null;
    } finally {
      setBusy(false);
    }
  }

  // ── Dibujo ───────────────────────────────────────────────────────────
  function onCanvasClick(e: React.MouseEvent) {
    if (mode !== 'draw') return;
    setDraft((d) => [...d, toSvg(e.clientX, e.clientY)]);
  }
  async function finishDraw() {
    if (draft.length < 3 || !newName.trim()) return;
    const r = await call('POST', '/paddocks', { name: newName, pasture_type: newPasture, boundary: { type: 'Polygon', coordinates: [draft] } });
    if (r) { setMode('view'); setDraft([]); setNewName(''); setNewPasture('natural'); }
  }

  // ── Edición de forma ─────────────────────────────────────────────────
  function startEdit(p: Paddock) {
    setEditRing(p.boundary?.coordinates?.[0]?.map((pt) => [pt[0], pt[1]]) ?? []);
    setMode('edit');
  }
  function onPointerMove(e: React.PointerEvent) {
    if (mode !== 'edit' || dragIdx.current == null) return;
    const [x, y] = toSvg(e.clientX, e.clientY);
    setEditRing((r) => r.map((pt, i) => (i === dragIdx.current ? [x, y] : pt)));
  }
  function insertVertex(i: number) {
    setEditRing((r) => {
      const a = r[i];
      const b = r[(i + 1) % r.length];
      const mid = [Math.round((a[0] + b[0]) / 2), Math.round((a[1] + b[1]) / 2)];
      const next = [...r];
      next.splice(i + 1, 0, mid);
      return next;
    });
  }
  function deleteVertex(i: number) {
    setEditRing((r) => (r.length <= 3 ? r : r.filter((_, idx) => idx !== i)));
  }
  async function saveShape() {
    if (!selected || editRing.length < 3) return;
    const r = await call('PUT', `/paddocks/${selected.id}`, { boundary: { type: 'Polygon', coordinates: [editRing] } });
    if (r) setMode('view');
  }

  const liveArea = mode === 'draw' ? areaHa(draft) : mode === 'edit' ? areaHa(editRing) : 0;

  return (
    <div className="grid grid-cols-3 gap-4 max-lg:grid-cols-1">
      <div className="col-span-2 rounded-[10px] border border-subtle bg-surface p-3 shadow-[var(--shadow-1)]">
        <div className="mb-2 flex items-center justify-between px-1">
          {mode === 'view' ? (
            <div className="flex gap-1 rounded-md bg-sunken p-1">
              {(['cabezas', 'carga'] as Metric[]).map((m) => (
                <button key={m} onClick={() => setMetric(m)} className={`h-7 rounded px-3 text-label font-medium ${metric === m ? 'bg-surface text-ink shadow-[var(--shadow-1)]' : 'text-ink-2'}`}>
                  {m === 'cabezas' ? 'Ocupación' : 'Carga (cab/ha)'}
                </button>
              ))}
            </div>
          ) : (
            <div className="text-label font-medium text-ink-2">
              {mode === 'draw' ? 'Dibujando: tocá el mapa para agregar vértices' : `Editando ${selected?.name}: arrastrá los vértices`}
              {liveArea > 0 && <span className="ml-2 tnum text-brand">≈ {liveArea} ha</span>}
            </div>
          )}
          {mode === 'view' ? (
            <Button size="sm" onClick={() => { setMode('draw'); setDraft([]); setSelectedId(null); }} className="gap-1"><Plus size={14} /> Dibujar potrero</Button>
          ) : (
            <div className="flex gap-1.5">
              {mode === 'draw' && <Button size="sm" variant="secondary" disabled={!draft.length} onClick={() => setDraft((d) => d.slice(0, -1))} className="gap-1"><Undo2 size={14} /> Deshacer</Button>}
              <Button size="sm" variant="secondary" onClick={() => { setMode('view'); setDraft([]); setEditRing([]); }} className="gap-1"><X size={14} /> Cancelar</Button>
              {mode === 'edit' && <Button size="sm" loading={busy} disabled={editRing.length < 3} onClick={saveShape} className="gap-1"><Check size={14} /> Guardar forma</Button>}
            </div>
          )}
        </div>

        <svg
          ref={svgRef}
          viewBox="0 0 1000 700"
          className="w-full rounded-md"
          style={{ background: 'var(--bg-canvas)', cursor: mode === 'draw' ? 'crosshair' : 'default', touchAction: 'none' }}
          onClick={onCanvasClick}
          onPointerMove={onPointerMove}
          onPointerUp={() => (dragIdx.current = null)}
          onPointerLeave={() => (dragIdx.current = null)}
        >
          {/* Potreros existentes (ocultamos el que se está editando; se dibuja aparte) */}
          {paddocks.map((p) => {
            if (!p.boundary?.coordinates?.[0] || (mode === 'edit' && p.id === selectedId)) return null;
            const pts = p.boundary.coordinates[0];
            const [cx, cy] = centroid(pts);
            const isSelected = p.id === selectedId;
            const dim = mode !== 'view';
            return (
              <g key={p.id} onClick={() => mode === 'view' && setSelectedId(isSelected ? null : p.id)} style={{ cursor: mode === 'view' ? 'pointer' : 'default', opacity: dim ? 0.4 : 1 }}>
                <path d={pathOf(pts)} fill={fillFor(valueOf(p), max)} stroke={isSelected ? 'var(--accent)' : 'var(--border-strong)'} strokeWidth={isSelected ? 3 : 1.5} strokeDasharray={p.animal_count === 0 ? '6 4' : undefined} />
                <text x={cx} y={cy - 6} textAnchor="middle" fontSize="15" fontWeight="600" fill="var(--text-primary)">{p.name}</text>
                <text x={cx} y={cy + 12} textAnchor="middle" fontSize="12" fill="var(--text-secondary)">{p.animal_count > 0 ? (metric === 'cabezas' ? `${p.animal_count} cab.` : `${p.stocking_rate} cab/ha`) : 'vacío'}</text>
                <text x={cx} y={cy + 28} textAnchor="middle" fontSize="11" fill="var(--text-tertiary)">{p.area_ha ? `${p.area_ha} ha` : ''}</text>
              </g>
            );
          })}

          {/* Borrador de dibujo */}
          {mode === 'draw' && draft.length > 0 && (
            <g>
              <path d={draft.length >= 3 ? pathOf(draft) : draft.map((pt, i) => `${i === 0 ? 'M' : 'L'}${pt[0]},${pt[1]}`).join(' ')} fill="rgba(46,125,91,0.2)" stroke="var(--accent)" strokeWidth={2} strokeDasharray="4 3" />
              {draft.map((pt, i) => (
                <circle key={i} cx={pt[0]} cy={pt[1]} r={6} fill="var(--accent)" stroke="white" strokeWidth={2} />
              ))}
            </g>
          )}

          {/* Edición de forma: vértices arrastrables + puntos medios para insertar */}
          {mode === 'edit' && editRing.length > 0 && (
            <g>
              <path d={pathOf(editRing)} fill="rgba(46,125,91,0.2)" stroke="var(--accent)" strokeWidth={2} />
              {editRing.map((pt, i) => {
                const b = editRing[(i + 1) % editRing.length];
                const mid = [(pt[0] + b[0]) / 2, (pt[1] + b[1]) / 2];
                return (
                  <circle key={`m${i}`} cx={mid[0]} cy={mid[1]} r={4} fill="white" stroke="var(--accent)" strokeWidth={1.5} style={{ cursor: 'copy' }} onClick={(e) => { e.stopPropagation(); insertVertex(i); }} />
                );
              })}
              {editRing.map((pt, i) => (
                <circle
                  key={i}
                  cx={pt[0]}
                  cy={pt[1]}
                  r={8}
                  fill="var(--accent)"
                  stroke="white"
                  strokeWidth={2}
                  style={{ cursor: 'grab' }}
                  onPointerDown={(e) => { e.stopPropagation(); dragIdx.current = i; }}
                  onDoubleClick={(e) => { e.stopPropagation(); deleteVertex(i); }}
                />
              ))}
            </g>
          )}
        </svg>
        {mode === 'edit' && <p className="mt-2 px-1 text-caption text-ink-3">Arrastrá un vértice para moverlo · tocá un punto blanco del borde para insertar · doble-click en un vértice para borrarlo.</p>}
        {msg && <p className={`mt-2 px-1 text-label ${msg.startsWith('✓') ? 'text-success' : 'text-danger'}`}>{msg}</p>}
      </div>

      {/* Panel contextual */}
      <div className="self-start rounded-[10px] border border-subtle bg-surface p-5 shadow-[var(--shadow-1)]">
        {mode === 'draw' ? (
          <div>
            <h2 className="text-compat-16 font-semibold">Nuevo potrero</h2>
            <p className="mt-0.5 text-label text-ink-3">{draft.length} vértices · ≈ {areaHa(draft)} ha</p>
            <div className="mt-4 space-y-2">
              <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Nombre del potrero" aria-label="Nombre" />
              <Select value={newPasture} onChange={(e) => setNewPasture(e.target.value)} aria-label="Tipo de pastura">
                {PASTURES.map((p) => <option key={p} value={p}>{p}</option>)}
              </Select>
              <Button size="sm" fullWidth loading={busy} disabled={busy || draft.length < 3 || !newName.trim()} onClick={finishDraw}>
                Crear potrero ({draft.length} vértices)
              </Button>
              {draft.length < 3 && <p className="text-caption text-ink-3">Agregá al menos 3 vértices tocando el mapa.</p>}
            </div>
          </div>
        ) : mode === 'edit' ? (
          <div>
            <h2 className="text-compat-16 font-semibold">Editando forma</h2>
            <p className="mt-0.5 text-label text-ink-3">{selected?.name} · {editRing.length} vértices · ≈ {areaHa(editRing)} ha</p>
            <p className="mt-4 text-body text-ink-2">Ajustá los vértices en el mapa y guardá. La superficie se recalcula del polígono.</p>
          </div>
        ) : !selected ? (
          <div className="py-10 text-center">
            <MapPin size={22} className="mx-auto mb-3 text-ink-3" strokeWidth={1.5} />
            <p className="text-body text-ink-2">Tocá un potrero para ver su ocupación, o dibujá uno nuevo.</p>
          </div>
        ) : (
          <div>
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-compat-16 font-semibold">{selected.name}</h2>
                <p className="mt-0.5 text-label text-ink-3 capitalize">{selected.pasture_type ?? 'sin tipo'} · {selected.area_ha ?? '—'} ha</p>
              </div>
              <div className="flex gap-1">
                <Button variant="secondary" size="sm" onClick={() => startEdit(selected)} disabled={!selected.boundary} aria-label="Editar forma" className="gap-1"><Pencil size={13} /> Forma</Button>
                <Button variant="secondary" size="sm" onClick={() => call('DELETE', `/paddocks/${selected.id}`).then((r) => r && setSelectedId(null))} disabled={busy} aria-label="Borrar potrero"><Trash2 size={14} /></Button>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-md bg-sunken p-3"><div className="text-caption text-ink-3">Cabezas</div><div className="tnum text-compat-22 font-semibold">{selected.animal_count}</div></div>
              <div className="rounded-md bg-sunken p-3"><div className="text-caption text-ink-3">Carga</div><div className="tnum text-compat-22 font-semibold">{selected.stocking_rate ?? '—'}<span className="ml-1 text-caption font-normal text-ink-3">cab/ha</span></div></div>
            </div>

            <div className="mt-4">
              <div className="mb-1.5 text-caption font-medium tracking-[0.06em] text-ink-3 uppercase">Lotes en el potrero</div>
              {selected.lots.length === 0 ? (
                <p className="text-body text-ink-3">Sin lotes — potrero en descanso.</p>
              ) : (
                <div className="space-y-1">
                  {selected.lots.map((l) => (
                    <div key={l.id} className="flex items-center justify-between rounded-md border border-subtle px-3 py-2 text-body">
                      <span className="font-medium">{l.name}</span>
                      <span className="text-label text-ink-3">{PURPOSE[l.purpose ?? ''] ?? l.purpose ?? ''} · {l.animal_count} cab.</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="mt-5 border-t border-subtle pt-4">
              <div className="mb-1.5 text-caption font-medium tracking-[0.06em] text-ink-3 uppercase">Mover lote acá</div>
              <div className="flex gap-2">
                <Select aria-label="Seleccionar lote para mover" value={moveLotId} onChange={(e) => setMoveLotId(e.target.value)} controlSize="md" fullWidth={false} className="min-w-0 flex-1">
                  <option value="">Elegir lote…</option>
                  {movableLots.map((l) => <option key={l.id} value={l.id}>{l.name} ({l.animal_count} cab.)</option>)}
                </Select>
                <Button size="md" onClick={() => call('POST', `/paddocks/${selected.id}/move-lot`, { lot_id: moveLotId }).then((r) => { if (r) { setMsg(`✓ ${r.lot}: ${r.moved} animales a ${r.to}`); setMoveLotId(''); } })} disabled={!moveLotId} loading={busy} className="gap-1 shrink-0"><MoveRight size={14} /> Mover</Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
