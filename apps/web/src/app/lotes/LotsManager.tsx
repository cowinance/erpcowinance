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

  async function open(id: string) {
    setSelectedId(id); setMode('none'); setError('');
    const d = await call('GET', `/lots/${id}`);
    if (d) setDetail(d);
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

            <Link href={`/animales?lot=${detail.id}`} className="mt-5 inline-block text-label font-medium text-brand hover:underline">Ver animales del lote →</Link>
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
