'use client';

/**
 * Mapa 2D básico de potreros (Fase 1; doc diseño §10.6 y §12.4):
 * polígonos con relleno por métrica seleccionable, etiqueta interior
 * (nombre + cabezas) y panel contextual con acciones (mover lote aquí).
 */
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { API_URL, authHeaders } from '@/lib/api';
import { MoveRight, MapPin } from 'lucide-react';

interface Paddock {
  id: string;
  name: string;
  boundary: { type: string; coordinates: number[][][] };
  area_ha: number | null;
  pasture_type: string | null;
  animal_count: number;
  stocking_rate: number | null;
  lots: { id: string; name: string; purpose: string | null; animal_count: number }[];
}

type Metric = 'cabezas' | 'carga';

/** Escala secuencial verde→ámbar (doc §4.6) sobre el valor normalizado 0..1. */
function fillFor(value: number, max: number): string {
  if (value <= 0) return 'var(--bg-sunken)';
  const t = Math.min(1, value / (max || 1));
  if (t < 0.35) return 'rgba(127, 191, 163, 0.45)'; // brand-300
  if (t < 0.7) return 'rgba(46, 125, 91, 0.55)'; // brand-500
  return 'rgba(217, 123, 43, 0.55)'; // amber (alta carga)
}

function centroid(pts: number[][]): [number, number] {
  const n = pts.length;
  return [pts.reduce((s, p) => s + p[0], 0) / n, pts.reduce((s, p) => s + p[1], 0) / n];
}

const PURPOSE: Record<string, string> = {
  breeding: 'Cría',
  fattening: 'Engorde',
  dairy: 'Lechería',
  weaning: 'Recría',
  quarantine: 'Cuarentena',
  hospital: 'Hospital',
};

export function FarmMap({ paddocks, lots }: { paddocks: Paddock[]; lots: any[] }) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [metric, setMetric] = useState<Metric>('cabezas');
  const [moveLotId, setMoveLotId] = useState('');
  const [moving, setMoving] = useState(false);
  const [moveMsg, setMoveMsg] = useState('');

  const selected = paddocks.find((p) => p.id === selectedId) ?? null;
  const valueOf = (p: Paddock) => (metric === 'cabezas' ? p.animal_count : (p.stocking_rate ?? 0));
  const max = useMemo(() => Math.max(...paddocks.map(valueOf), 0.001), [paddocks, metric]);
  const movableLots = lots.filter((l) => selected && !selected.lots.some((sl) => sl.id === l.id));

  async function moveLot() {
    if (!selected || !moveLotId) return;
    setMoving(true);
    setMoveMsg('');
    try {
      const res = await fetch(`${API_URL}/paddocks/${selected.id}/move-lot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ lot_id: moveLotId }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.message?.title ?? `Error ${res.status}`);
      setMoveMsg(`✓ ${body.lot}: ${body.moved} animales movidos a ${body.to}`);
      setMoveLotId('');
      router.refresh();
    } catch (e: any) {
      setMoveMsg(e.message);
    } finally {
      setMoving(false);
    }
  }

  return (
    <div className="grid grid-cols-3 gap-4 max-lg:grid-cols-1">
      <div className="col-span-2 rounded-[10px] border border-subtle bg-surface p-3 shadow-[var(--shadow-1)]">
        {/* Barra de métrica (estilo barra flotante glass del doc, versión sobria) */}
        <div className="mb-2 flex items-center justify-between px-1">
          <div className="flex gap-1 rounded-md bg-sunken p-1">
            {(['cabezas', 'carga'] as Metric[]).map((m) => (
              <button
                key={m}
                onClick={() => setMetric(m)}
                className={`h-7 rounded px-3 text-[12px] font-medium ${
                  metric === m ? 'bg-surface text-ink shadow-[var(--shadow-1)]' : 'text-ink-2'
                }`}
              >
                {m === 'cabezas' ? 'Ocupación (cabezas)' : 'Carga (cab/ha)'}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3 text-[11px] text-ink-3">
            <span className="inline-flex items-center gap-1">
              <span className="size-3 rounded-sm border border-subtle bg-sunken" /> vacío
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="size-3 rounded-sm" style={{ background: 'rgba(127,191,163,.45)' }} /> baja
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="size-3 rounded-sm" style={{ background: 'rgba(46,125,91,.55)' }} /> media
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="size-3 rounded-sm" style={{ background: 'rgba(217,123,43,.55)' }} /> alta
            </span>
          </div>
        </div>

        <svg viewBox="0 0 1000 700" className="w-full rounded-md" style={{ background: 'var(--bg-canvas)' }}>
          {paddocks.map((p) => {
            if (!p.boundary?.coordinates?.[0]) return null;
            const pts = p.boundary.coordinates[0];
            const d = pts.map((pt, i) => `${i === 0 ? 'M' : 'L'}${pt[0]},${pt[1]}`).join(' ') + ' Z';
            const [cx, cy] = centroid(pts);
            const isSelected = p.id === selectedId;
            return (
              <g key={p.id} onClick={() => setSelectedId(isSelected ? null : p.id)} style={{ cursor: 'pointer' }}>
                <path
                  d={d}
                  fill={fillFor(valueOf(p), max)}
                  stroke={isSelected ? 'var(--accent)' : 'var(--border-strong)'}
                  strokeWidth={isSelected ? 3 : 1.5}
                  strokeDasharray={p.animal_count === 0 ? '6 4' : undefined}
                />
                <text x={cx} y={cy - 8} textAnchor="middle" fontSize="15" fontWeight="600" fill="var(--text-primary)">
                  {p.name}
                </text>
                <text x={cx} y={cy + 12} textAnchor="middle" fontSize="13" fill="var(--text-secondary)">
                  {p.animal_count > 0
                    ? metric === 'cabezas'
                      ? `${p.animal_count} cabezas`
                      : `${p.stocking_rate} cab/ha`
                    : 'vacío'}
                </text>
                <text x={cx} y={cy + 30} textAnchor="middle" fontSize="11" fill="var(--text-tertiary)">
                  {p.area_ha ? `${p.area_ha} ha` : ''}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* Panel contextual (doc §12.4) */}
      <div className="self-start rounded-[10px] border border-subtle bg-surface p-5 shadow-[var(--shadow-1)]">
        {!selected ? (
          <div className="py-10 text-center">
            <MapPin size={22} className="mx-auto mb-3 text-ink-3" strokeWidth={1.5} />
            <p className="text-[13px] text-ink-2">Tocá un potrero para ver su ocupación y mover lotes.</p>
          </div>
        ) : (
          <div>
            <h2 className="text-[16px] font-semibold">{selected.name}</h2>
            <p className="mt-0.5 text-[12px] text-ink-3 capitalize">
              {selected.pasture_type ?? 'sin tipo'} · {selected.area_ha ?? '—'} ha
            </p>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-md bg-sunken p-3">
                <div className="text-[11px] text-ink-3">Cabezas</div>
                <div className="tnum text-[22px] font-semibold">{selected.animal_count}</div>
              </div>
              <div className="rounded-md bg-sunken p-3">
                <div className="text-[11px] text-ink-3">Carga</div>
                <div className="tnum text-[22px] font-semibold">
                  {selected.stocking_rate ?? '—'}
                  <span className="ml-1 text-[11px] font-normal text-ink-3">cab/ha</span>
                </div>
              </div>
            </div>

            <div className="mt-4">
              <div className="mb-1.5 text-[11px] font-medium tracking-[0.06em] text-ink-3 uppercase">Lotes en el potrero</div>
              {selected.lots.length === 0 ? (
                <p className="text-[13px] text-ink-3">Sin lotes — potrero en descanso.</p>
              ) : (
                <div className="space-y-1">
                  {selected.lots.map((l) => (
                    <div key={l.id} className="flex items-center justify-between rounded-md border border-subtle px-3 py-2 text-[13px]">
                      <span className="font-medium">{l.name}</span>
                      <span className="text-[12px] text-ink-3">
                        {PURPOSE[l.purpose ?? ''] ?? l.purpose ?? ''} · {l.animal_count} cab.
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="mt-5 border-t border-subtle pt-4">
              <div className="mb-1.5 text-[11px] font-medium tracking-[0.06em] text-ink-3 uppercase">Mover lote acá</div>
              <div className="flex gap-2">
                <select
                  value={moveLotId}
                  onChange={(e) => setMoveLotId(e.target.value)}
                  className="h-9 min-w-0 flex-1 rounded-md border border-strong bg-surface px-2 text-[13px] outline-none focus:ring-2 focus:ring-brand"
                >
                  <option value="">Elegir lote…</option>
                  {movableLots.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name} ({l.animal_count} cab.)
                    </option>
                  ))}
                </select>
                <button
                  onClick={moveLot}
                  disabled={!moveLotId || moving}
                  className="inline-flex h-9 shrink-0 items-center gap-1 rounded-md bg-brand px-3 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-50"
                >
                  <MoveRight size={14} /> {moving ? '…' : 'Mover'}
                </button>
              </div>
              {moveMsg && (
                <p className={`mt-2 text-[12px] ${moveMsg.startsWith('✓') ? 'text-success' : 'text-danger'}`}>{moveMsg}</p>
              )}
              <p className="mt-2 text-[11px] text-ink-3">
                El movimiento queda registrado en la línea de tiempo de cada animal.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
