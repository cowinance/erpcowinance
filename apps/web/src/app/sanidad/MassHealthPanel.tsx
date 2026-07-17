'use client';

/**
 * Aplicación masiva (Sanidad E4): vacunar o tratar por objetivo (todo el hato / lote / categoría),
 * con confirmación y resultado (aplicadas / salteadas). Reusa los endpoints /vaccinations/bulk y
 * /treatments/bulk (idempotentes por Idempotency-Key). Panel de cobertura por lote/categoría al lado.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { API_URL, authHeaders } from '@/lib/api';
import { Loader2, Syringe, Stethoscope } from 'lucide-react';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Select } from '@/components/Select';
import { Field } from '@/components/Field';

const cardCls = 'rounded-[10px] border border-subtle bg-surface p-5 shadow-[var(--shadow-1)]';

export function MassHealthPanel({ products = [], lots = [], categories = [] }: { products?: any[]; lots?: any[]; categories?: any[] }) {
  const router = useRouter();
  const [action, setAction] = useState<'vacc' | 'treat'>('vacc');
  const [scope, setScope] = useState<'all' | 'lot' | 'category'>('lot');
  const [lotId, setLotId] = useState('');
  const [categoryCode, setCategoryCode] = useState('');
  const [productId, setProductId] = useState('');
  const [dose, setDose] = useState('');
  const [batch, setBatch] = useState('');
  const [nextDueDays, setNextDueDays] = useState('');
  const [route, setRoute] = useState('sc');
  const [notes, setNotes] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any | null>(null);
  const [error, setError] = useState('');

  const options = useMemo(() => products.filter((p) => (action === 'vacc' ? p.type === 'vaccine' : p.type !== 'vaccine')), [products, action]);

  const estimate = useMemo(() => {
    if (scope === 'all') return lots.reduce((s, l) => s + (l.animal_count ?? 0), 0);
    if (scope === 'lot') return lots.find((l) => l.id === lotId)?.animal_count ?? 0;
    if (scope === 'category') return categories.find((c) => c.code === categoryCode)?.animal_count ?? 0;
    return 0;
  }, [scope, lotId, categoryCode, lots, categories]);

  const targetLabel =
    scope === 'all' ? 'todo el hato' : scope === 'lot' ? `lote ${lots.find((l) => l.id === lotId)?.name ?? '—'}` : `categoría ${categories.find((c) => c.code === categoryCode)?.name ?? '—'}`;

  function reset() {
    setConfirming(false);
    setResult(null);
    setError('');
  }

  async function apply() {
    setBusy(true);
    setError('');
    const url = action === 'vacc' ? '/vaccinations/bulk' : '/treatments/bulk';
    const body: any = { scope, product_id: productId };
    if (scope === 'lot') body.lot_id = lotId;
    if (scope === 'category') body.category_code = categoryCode;
    if (dose) body.dose = Number(dose);
    if (action === 'vacc') {
      if (batch) body.batch_number = batch;
      if (nextDueDays) body.next_due_days = Number(nextDueDays);
    } else {
      body.route = route;
      if (notes) body.notes = notes;
    }
    const res = await fetch(`${API_URL}${url}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID(), ...authHeaders() },
      body: JSON.stringify(body),
    });
    const j = await res.json().catch(() => null);
    setBusy(false);
    setConfirming(false);
    if (res.ok) {
      setResult(j);
      router.refresh();
    } else setError(j?.message?.title ?? 'No se pudo aplicar');
  }

  const canApply = !!productId && (scope !== 'lot' || !!lotId) && (scope !== 'category' || !!categoryCode);

  return (
    <div className="mt-4 grid grid-cols-2 gap-4 max-lg:grid-cols-1">
      {/* Aplicación masiva */}
      <div className={cardCls}>
        <h2 className="mb-3 flex items-center gap-2 text-subheading font-semibold">
          {action === 'vacc' ? <Syringe size={16} className="text-brand" /> : <Stethoscope size={16} className="text-brand" />} Aplicación masiva
        </h2>

        <div className="mb-3 inline-flex rounded-md border border-subtle p-0.5">
          {(['vacc', 'treat'] as const).map((a) => (
            <button
              key={a}
              onClick={() => { setAction(a); setProductId(''); reset(); }}
              className={`rounded px-3 py-1 text-label font-medium ${action === a ? 'bg-brand-soft text-brand' : 'text-ink-3 hover:text-ink-2'}`}
            >
              {a === 'vacc' ? 'Vacunar' : 'Tratar'}
            </button>
          ))}
        </div>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Objetivo" htmlFor="scope">
              <Select id="scope" value={scope} onChange={(e) => { setScope(e.target.value as any); reset(); }} controlSize="md">
                <option value="all">Todo el hato</option>
                <option value="lot">Lote</option>
                <option value="category">Categoría</option>
              </Select>
            </Field>
            {scope === 'lot' && (
              <Field label="Lote" htmlFor="lot">
                <Select id="lot" value={lotId} onChange={(e) => { setLotId(e.target.value); reset(); }} controlSize="md">
                  <option value="">Elegir…</option>
                  {lots.filter((l) => l.is_active !== false).map((l) => (
                    <option key={l.id} value={l.id}>{l.name} ({l.animal_count} cab.)</option>
                  ))}
                </Select>
              </Field>
            )}
            {scope === 'category' && (
              <Field label="Categoría" htmlFor="cat">
                <Select id="cat" value={categoryCode} onChange={(e) => { setCategoryCode(e.target.value); reset(); }} controlSize="md">
                  <option value="">Elegir…</option>
                  {categories.filter((c) => c.animal_count > 0).map((c) => (
                    <option key={c.code} value={c.code}>{c.name} ({c.animal_count})</option>
                  ))}
                </Select>
              </Field>
            )}
          </div>

          <Field label={action === 'vacc' ? 'Vacuna' : 'Producto'} htmlFor="prod">
            <Select id="prod" value={productId} onChange={(e) => { setProductId(e.target.value); reset(); }} controlSize="md">
              <option value="">Elegir…</option>
              {options.map((p) => (
                <option key={p.id} value={p.id}>{p.name}{p.withdrawal_meat_days ? ` (retiro ${p.withdrawal_meat_days} d)` : ''}</option>
              ))}
            </Select>
          </Field>

          {action === 'vacc' ? (
            <div className="grid grid-cols-3 gap-3">
              <Field label="Dosis (ml)" htmlFor="dose"><Input id="dose" type="number" step="0.5" value={dose} onChange={(e) => setDose(e.target.value)} controlSize="md" placeholder="2" /></Field>
              <Field label="Lote frasco" htmlFor="batch"><Input id="batch" value={batch} onChange={(e) => setBatch(e.target.value)} controlSize="md" placeholder="AF-…" /></Field>
              <Field label="Refuerzo (d)" htmlFor="nd"><Input id="nd" type="number" value={nextDueDays} onChange={(e) => setNextDueDays(e.target.value)} controlSize="md" placeholder="180" /></Field>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Dosis (ml)" htmlFor="dose"><Input id="dose" type="number" step="0.5" value={dose} onChange={(e) => setDose(e.target.value)} controlSize="md" placeholder="10" /></Field>
              <Field label="Vía" htmlFor="route">
                <Select id="route" value={route} onChange={(e) => setRoute(e.target.value)} controlSize="md">
                  <option value="sc">Subcutánea</option><option value="im">Intramuscular</option><option value="iv">Intravenosa</option><option value="oral">Oral</option><option value="topical">Tópica</option>
                </Select>
              </Field>
            </div>
          )}

          {!confirming && !result && (
            <Button size="md" fullWidth disabled={!canApply} onClick={() => setConfirming(true)}>
              Aplicar a {targetLabel}
            </Button>
          )}

          {confirming && (
            <div className="rounded-md border border-warning/40 bg-warning/5 p-3">
              <p className="mb-2 text-label text-ink-2">
                Vas a {action === 'vacc' ? 'vacunar' : 'tratar'} <span className="font-medium">~{estimate} animales</span> de <span className="font-medium">{targetLabel}</span>. Los no aptos (muertos/vendidos) se saltean.
              </p>
              <div className="flex gap-2">
                <Button size="sm" onClick={apply} loading={busy}>Confirmar</Button>
                <Button size="sm" variant="secondary" onClick={() => setConfirming(false)}>Cancelar</Button>
              </div>
            </div>
          )}

          {result && (
            <div className="rounded-md border border-success/40 bg-success/5 p-3 text-label">
              <p className="text-success">✓ {result.applied} aplicadas{result.already ? `, ${result.already} ya estaban` : ''}{result.skipped ? `, ${result.skipped} salteadas` : ''} (objetivo: {result.resolved}).</p>
              <button onClick={reset} className="mt-1 text-caption text-brand hover:underline">Nueva aplicación</button>
            </div>
          )}
          {error && <p className="text-label text-danger">{error}</p>}
        </div>
      </div>

      <CoverageCard products={products} />
    </div>
  );
}

function CoverageCard({ products }: { products: any[] }) {
  const [by, setBy] = useState<'lot' | 'category'>('lot');
  const [productId, setProductId] = useState('');
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const vaccines = products.filter((p) => p.type === 'vaccine');

  const load = useCallback(async () => {
    setLoading(true);
    const qs = new URLSearchParams({ by });
    if (productId) qs.set('product_id', productId);
    const r = await fetch(`${API_URL}/health/coverage?${qs}`, { headers: authHeaders() }).then((x) => x.json()).catch(() => []);
    setRows(Array.isArray(r) ? r : []);
    setLoading(false);
  }, [by, productId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className={cardCls}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-subheading font-semibold">Cobertura de vacunación</h2>
        <div className="flex gap-2">
          <Select value={by} onChange={(e) => setBy(e.target.value as any)} controlSize="sm" fullWidth={false}>
            <option value="lot">Por lote</option>
            <option value="category">Por categoría</option>
          </Select>
          <Select value={productId} onChange={(e) => setProductId(e.target.value)} controlSize="sm" fullWidth={false}>
            <option value="">Cualquier vacuna</option>
            {vaccines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </div>
      </div>
      {loading ? (
        <div className="flex justify-center py-6 text-ink-3"><Loader2 size={16} className="animate-spin" /></div>
      ) : rows.length === 0 ? (
        <p className="py-6 text-center text-body text-ink-3">Sin datos de cobertura.</p>
      ) : (
        <div className="max-h-96 space-y-2 overflow-y-auto">
          {rows.map((r) => {
            const pct = r.pct ?? 0;
            const tone = pct >= 90 ? 'bg-success' : pct >= 60 ? 'bg-warning' : 'bg-danger';
            return (
              <div key={r.group_id}>
                <div className="flex items-center justify-between text-label">
                  <span className="truncate text-ink-2">{r.group_name}</span>
                  <span className="tnum shrink-0 text-ink-3">{r.vaccinated}/{r.head} · {pct}%</span>
                </div>
                <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-sunken">
                  <div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.min(100, pct)}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
