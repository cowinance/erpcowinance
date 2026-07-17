'use client';

/**
 * Navegador del hato (Animales E1) — filtros avanzados, orden configurable, búsqueda por
 * cualquier identificador y paginación por cursor («cargar más»). Carga desde GET /animals
 * en el cliente para acumular páginas sin recargar. La vista tabla reusa AnimalsTable
 * (selección + mover); la vista tarjetas es propia. Fuente única de la lista: la API.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Filter, LayoutGrid, Rows3, Search, SlidersHorizontal, X } from 'lucide-react';
import { API_URL, authHeaders, fileUrl } from '@/lib/api';
import { ageFrom, formatKg, relativeTime, STATUS_LABELS } from '@/lib/format';
import { StatusBadge } from '@/components/ui';
import { AnimalsTable } from './AnimalsTable';
import type { MoveLot } from '@/components/MoveDialog';

type Filters = {
  q: string;
  status: string;
  category: string;
  lot: string;
  sex: string;
  origin: string;
  minWeight: string;
  maxWeight: string;
  minAge: string;
  maxAge: string;
  withLot: string; // '', 'true', 'false'
  withPhoto: string;
  withOfficialId: string;
  withdrawal: boolean;
  openCase: boolean;
  pregnant: boolean;
  noRecentWeighing: string; // días o ''
  sort: string;
  dir: 'asc' | 'desc';
};

const SORT_LABELS: Record<string, string> = {
  created: 'Fecha de alta',
  tag: 'Caravana',
  age: 'Edad',
  weight: 'Último peso',
  gdp: 'GDP',
  lot: 'Lote',
  category: 'Categoría',
  status: 'Estado',
};

const PAGE = 50;

export function AnimalsBrowser({
  categories,
  lots,
  initial,
}: {
  categories: any[];
  lots: MoveLot[];
  initial: { q?: string; category?: string; status?: string; lot?: string };
}) {
  const [f, setF] = useState<Filters>({
    q: initial.q ?? '',
    status: initial.status ?? 'active',
    category: initial.category ?? '',
    lot: initial.lot ?? '',
    sex: '',
    origin: '',
    minWeight: '',
    maxWeight: '',
    minAge: '',
    maxAge: '',
    withLot: '',
    withPhoto: '',
    withOfficialId: '',
    withdrawal: false,
    openCase: false,
    pregnant: false,
    noRecentWeighing: '',
    sort: 'created',
    dir: 'desc',
  });
  const [rows, setRows] = useState<any[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [view, setView] = useState<'table' | 'cards'>('table');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const reqId = useRef(0);

  const buildQs = useCallback((cur?: string | null) => {
    const qs = new URLSearchParams();
    if (f.q.trim()) qs.set('q', f.q.trim());
    if (f.status && f.status !== 'all') qs.set('status', f.status);
    if (f.status === 'all') qs.set('status', '');
    if (f.category) qs.set('category', f.category);
    if (f.lot) qs.set('lot', f.lot);
    if (f.sex) qs.set('sex', f.sex);
    if (f.origin) qs.set('origin', f.origin);
    if (f.minWeight) qs.set('min_weight', f.minWeight);
    if (f.maxWeight) qs.set('max_weight', f.maxWeight);
    if (f.minAge) qs.set('min_age', f.minAge);
    if (f.maxAge) qs.set('max_age', f.maxAge);
    if (f.withLot) qs.set('with_lot', f.withLot);
    if (f.withPhoto) qs.set('with_photo', f.withPhoto);
    if (f.withOfficialId) qs.set('with_official_id', f.withOfficialId);
    if (f.withdrawal) qs.set('withdrawal', 'true');
    if (f.openCase) qs.set('open_case', 'true');
    if (f.pregnant) qs.set('pregnant', 'true');
    if (f.noRecentWeighing) qs.set('no_recent_weighing', f.noRecentWeighing);
    qs.set('sort', f.sort);
    qs.set('dir', f.dir);
    qs.set('limit', String(PAGE));
    if (cur) qs.set('cursor', cur);
    return qs.toString();
  }, [f]);

  // Recarga completa cuando cambian los filtros (con debounce leve para la búsqueda).
  useEffect(() => {
    const id = ++reqId.current;
    setLoading(true);
    const t = setTimeout(() => {
      fetch(`${API_URL}/animals?${buildQs()}`, { headers: authHeaders() })
        .then((r) => r.json())
        .then((d) => {
          if (id !== reqId.current) return;
          setRows(d?.data ?? []);
          setCursor(d?.next_cursor ?? null);
        })
        .catch(() => {
          if (id !== reqId.current) return;
          setRows([]);
          setCursor(null);
        })
        .finally(() => id === reqId.current && setLoading(false));
    }, 250);
    return () => clearTimeout(t);
  }, [buildQs]);

  const loadMore = () => {
    if (!cursor) return;
    setLoadingMore(true);
    fetch(`${API_URL}/animals?${buildQs(cursor)}`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => {
        setRows((prev) => [...prev, ...(d?.data ?? [])]);
        setCursor(d?.next_cursor ?? null);
      })
      .finally(() => setLoadingMore(false));
  };

  const set = (patch: Partial<Filters>) => setF((s) => ({ ...s, ...patch }));
  const activeAdvanced =
    [f.sex, f.origin, f.minWeight, f.maxWeight, f.minAge, f.maxAge, f.withLot, f.withPhoto, f.withOfficialId, f.noRecentWeighing].filter(Boolean).length +
    [f.withdrawal, f.openCase, f.pregnant].filter(Boolean).length;

  const clearAdvanced = () =>
    set({
      sex: '', origin: '', minWeight: '', maxWeight: '', minAge: '', maxAge: '',
      withLot: '', withPhoto: '', withOfficialId: '', withdrawal: false, openCase: false, pregnant: false, noRecentWeighing: '',
    });

  const inputCls = 'h-8 rounded-md border border-strong bg-surface px-2 text-body outline-none focus:ring-2 focus:ring-brand';

  return (
    <div>
      {/* Barra principal: búsqueda + estado + orden + vista */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={15} className="absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-3" />
          <input
            value={f.q}
            onChange={(e) => set({ q: e.target.value })}
            placeholder="Caravana, RFID, ID oficial o nombre…"
            className={`${inputCls} w-72 pl-8`}
          />
        </div>

        <select value={f.status} onChange={(e) => set({ status: e.target.value })} className={inputCls}>
          <option value="active">Activos</option>
          <option value="sold">Vendidos</option>
          <option value="dead">Muertos</option>
          <option value="culled">Descartados</option>
          <option value="lost">Perdidos</option>
          <option value="transferred">Transferidos</option>
          <option value="all">Todos los estados</option>
        </select>

        <select value={f.category} onChange={(e) => set({ category: e.target.value })} className={inputCls}>
          <option value="">Todas las categorías</option>
          {(categories ?? []).map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}{c.animal_count != null ? ` (${c.animal_count})` : ''}
            </option>
          ))}
        </select>

        <select value={f.lot} onChange={(e) => set({ lot: e.target.value })} className={inputCls}>
          <option value="">Todos los lotes</option>
          {(lots ?? []).map((l) => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </select>

        <button
          onClick={() => setShowAdvanced((v) => !v)}
          className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-label font-medium ${
            showAdvanced || activeAdvanced ? 'border-brand bg-brand-soft text-brand' : 'border-strong text-ink-2 hover:bg-sunken'
          }`}
        >
          <SlidersHorizontal size={14} /> Filtros{activeAdvanced ? ` (${activeAdvanced})` : ''}
        </button>

        <div className="ml-auto flex items-center gap-2">
          <div className="flex items-center gap-1 text-label text-ink-3">
            <Filter size={13} />
            <select value={f.sort} onChange={(e) => set({ sort: e.target.value })} className={`${inputCls} h-8`}>
              {Object.entries(SORT_LABELS).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
            <button
              onClick={() => set({ dir: f.dir === 'asc' ? 'desc' : 'asc' })}
              className="h-8 rounded-md border border-strong px-2 text-ink-2 hover:bg-sunken"
              title={f.dir === 'asc' ? 'Ascendente' : 'Descendente'}
            >
              {f.dir === 'asc' ? '↑' : '↓'}
            </button>
          </div>
          <div className="flex overflow-hidden rounded-md border border-strong">
            <button
              onClick={() => setView('table')}
              className={`flex h-8 w-8 items-center justify-center ${view === 'table' ? 'bg-brand-soft text-brand' : 'text-ink-3 hover:bg-sunken'}`}
              title="Tabla"
            >
              <Rows3 size={15} />
            </button>
            <button
              onClick={() => setView('cards')}
              className={`flex h-8 w-8 items-center justify-center border-l border-strong ${view === 'cards' ? 'bg-brand-soft text-brand' : 'text-ink-3 hover:bg-sunken'}`}
              title="Tarjetas"
            >
              <LayoutGrid size={15} />
            </button>
          </div>
        </div>
      </div>

      {/* Panel de filtros avanzados */}
      {showAdvanced && (
        <div className="mb-3 rounded-[10px] border border-subtle bg-sunken/40 p-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-caption font-medium text-ink-2">
              Sexo
              <select value={f.sex} onChange={(e) => set({ sex: e.target.value })} className={inputCls}>
                <option value="">Todos</option>
                <option value="F">Hembra</option>
                <option value="M">Macho</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-caption font-medium text-ink-2">
              Origen
              <select value={f.origin} onChange={(e) => set({ origin: e.target.value })} className={inputCls}>
                <option value="">Todos</option>
                <option value="born">Nacido</option>
                <option value="purchased">Comprado</option>
                <option value="transferred">Transferido</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-caption font-medium text-ink-2">
              Peso (kg)
              <span className="flex items-center gap-1">
                <input type="number" value={f.minWeight} onChange={(e) => set({ minWeight: e.target.value })} placeholder="mín" className={`${inputCls} w-20`} />
                <span className="text-ink-3">–</span>
                <input type="number" value={f.maxWeight} onChange={(e) => set({ maxWeight: e.target.value })} placeholder="máx" className={`${inputCls} w-20`} />
              </span>
            </label>
            <label className="flex flex-col gap-1 text-caption font-medium text-ink-2">
              Edad (meses)
              <span className="flex items-center gap-1">
                <input type="number" value={f.minAge} onChange={(e) => set({ minAge: e.target.value })} placeholder="mín" className={`${inputCls} w-20`} />
                <span className="text-ink-3">–</span>
                <input type="number" value={f.maxAge} onChange={(e) => set({ maxAge: e.target.value })} placeholder="máx" className={`${inputCls} w-20`} />
              </span>
            </label>
            <label className="flex flex-col gap-1 text-caption font-medium text-ink-2">
              Lote
              <select value={f.withLot} onChange={(e) => set({ withLot: e.target.value })} className={inputCls}>
                <option value="">Todos</option>
                <option value="true">Con lote</option>
                <option value="false">Sin lote</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-caption font-medium text-ink-2">
              Foto
              <select value={f.withPhoto} onChange={(e) => set({ withPhoto: e.target.value })} className={inputCls}>
                <option value="">Todas</option>
                <option value="true">Con foto</option>
                <option value="false">Sin foto</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-caption font-medium text-ink-2">
              ID oficial
              <select value={f.withOfficialId} onChange={(e) => set({ withOfficialId: e.target.value })} className={inputCls}>
                <option value="">Todos</option>
                <option value="true">Con ID oficial</option>
                <option value="false">Sin ID oficial</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-caption font-medium text-ink-2">
              Sin pesaje hace
              <span className="flex items-center gap-1">
                <input type="number" value={f.noRecentWeighing} onChange={(e) => set({ noRecentWeighing: e.target.value })} placeholder="días" className={`${inputCls} w-20`} />
              </span>
            </label>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {([
              ['withdrawal', 'Retiro activo'],
              ['openCase', 'Caso clínico abierto'],
              ['pregnant', 'Preñadas'],
            ] as const).map(([k, l]) => (
              <button
                key={k}
                onClick={() => set({ [k]: !f[k] } as any)}
                className={`inline-flex h-7 items-center rounded-full border px-3 text-label font-medium ${
                  f[k] ? 'border-brand bg-brand-soft text-brand' : 'border-subtle bg-surface text-ink-2 hover:bg-sunken'
                }`}
              >
                {l}
              </button>
            ))}
            {activeAdvanced > 0 && (
              <button onClick={clearAdvanced} className="ml-auto inline-flex items-center gap-1 text-label text-ink-3 hover:text-ink">
                <X size={13} /> Limpiar filtros
              </button>
            )}
          </div>
        </div>
      )}

      {/* Contador de resultados */}
      <p className="mb-2 text-label text-ink-3">
        {loading ? 'Cargando…' : `${rows.length} cargado${rows.length === 1 ? '' : 's'}${cursor ? ' · hay más' : ''}`}
      </p>

      {/* Resultados */}
      {view === 'table' ? (
        <AnimalsTable animals={rows} lots={lots} />
      ) : (
        <CardsView rows={rows} />
      )}

      {/* Cargar más */}
      {cursor && !loading && (
        <div className="mt-4 flex justify-center">
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="inline-flex h-9 items-center rounded-md border border-strong px-5 text-body font-medium text-ink-2 hover:bg-sunken disabled:opacity-50"
          >
            {loadingMore ? 'Cargando…' : 'Cargar más'}
          </button>
        </div>
      )}
    </div>
  );
}

function CardsView({ rows }: { rows: any[] }) {
  if (!rows.length) {
    return <p className="py-10 text-center text-body text-ink-3">No hay animales con ese filtro.</p>;
  }
  return (
    <div className="grid grid-cols-4 gap-3 max-lg:grid-cols-3 max-md:grid-cols-2">
      {rows.map((a) => (
        <Link
          key={a.id}
          href={`/animales/${a.id}`}
          className="flex flex-col rounded-[10px] border border-subtle bg-surface p-3 shadow-[var(--shadow-1)] hover:border-strong"
        >
          <div className="flex items-center gap-3">
            {fileUrl(a.photo) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={fileUrl(a.photo)!} alt="" className="size-12 rounded-full border border-subtle object-cover" />
            ) : (
              <span className="size-12 rounded-full border border-dashed border-strong bg-sunken" />
            )}
            <div className="min-w-0">
              <div className="truncate font-mono font-semibold text-brand">{a.tag ?? '—'}</div>
              <div className="truncate text-label text-ink-3">{a.name ?? a.category ?? '—'}</div>
            </div>
          </div>
          <div className="mt-2.5 flex items-center justify-between text-label">
            <StatusBadge status={a.status} label={STATUS_LABELS[a.status] ?? a.status} />
            <span className="text-ink-3">{ageFrom(a.birth_date)}</span>
          </div>
          <div className="mt-1.5 flex items-center justify-between text-label text-ink-2">
            <span className="truncate">{a.lot_name ?? 'sin lote'}</span>
            <span className="tnum font-medium">
              {formatKg(a.last_weight_kg)}
              {a.last_weighed_at && <span className="ml-1 text-caption font-normal text-ink-3">{relativeTime(a.last_weighed_at)}</span>}
            </span>
          </div>
        </Link>
      ))}
    </div>
  );
}
