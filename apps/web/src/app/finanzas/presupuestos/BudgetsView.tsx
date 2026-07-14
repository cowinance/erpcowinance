'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { API_URL, authHeaders } from '@/lib/api';
import { Card, CardTitle } from '@/components/ui';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Select } from '@/components/Select';

interface Budget {
  id: string;
  name: string;
  fiscal_year: number;
  status: string;
  total: number;
}
interface Account {
  id: string;
  code: string;
  name: string;
}
interface Named {
  id: string;
  name: string;
}
interface Line {
  account_id: string;
  cost_center_id: string;
  month: string;
  amount: string;
}
interface VsRow {
  account_id: string;
  account_code: string;
  account_name: string;
  account_type: string;
  budget: number;
  actual: number;
  variance: number;
  variance_pct: number | null;
}

const STATUS: Record<string, string> = { draft: 'Borrador', approved: 'Aprobado', closed: 'Cerrado' };
const ACTIONS: Record<string, [string, string][]> = { draft: [['approved', 'Aprobar']], approved: [['closed', 'Cerrar']] };
const MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
/** Cuentas de saldo deudor: un desvío positivo es SOBREGIRO (malo). En las acreedoras es al revés. */
const DEBIT_NORMAL = new Set(['asset', 'expense']);
const isBad = (r: VsRow) => (DEBIT_NORMAL.has(r.account_type) ? r.variance > 0 : r.variance < 0);

export function BudgetsView({ budgets, accounts, costCenters }: { budgets: Budget[]; accounts: Account[]; costCenters: Named[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [year, setYear] = useState('');
  const [selected, setSelected] = useState<Budget | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [vs, setVs] = useState<VsRow[]>([]);

  const editable = selected?.status === 'draft';

  async function call(method: string, path: string, data?: any) {
    setError('');
    const res = await fetch(`${API_URL}${path}`, { method, headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: data ? JSON.stringify(data) : undefined });
    if (!res.ok) {
      const j = await res.json().catch(() => null);
      throw new Error(j?.title ?? `Error ${res.status}`);
    }
    return res.json().catch(() => null);
  }

  async function createBudget() {
    if (busy || !name.trim() || !year) return;
    setBusy(true);
    try {
      await call('POST', '/finance/budgets', { name: name.trim(), fiscal_year: Number(year) });
      setName('');
      setYear('');
      router.refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function selectBudget(b: Budget) {
    setSelected(b);
    setError('');
    try {
      const detail = await call('GET', `/finance/budgets/${b.id}`);
      setLines((detail?.lines ?? []).map((l: any) => ({ account_id: l.account_id, cost_center_id: l.cost_center_id ?? '', month: String(l.month), amount: String(l.amount) })));
      setVs(await call('GET', `/finance/budgets/${b.id}/vs-actual`));
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function saveLines() {
    if (busy || !selected) return;
    setBusy(true);
    try {
      const payload = lines
        .filter((l) => l.account_id && l.month && l.amount !== '')
        .map((l) => ({ account_id: l.account_id, cost_center_id: l.cost_center_id || undefined, month: Number(l.month), amount: Number(l.amount) }));
      await call('PUT', `/finance/budgets/${selected.id}/lines`, { lines: payload });
      await selectBudget(selected); // recarga líneas + comparativo
      router.refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function transition(id: string, status: string) {
    if (busy) return;
    setBusy(true);
    try {
      await call('PATCH', `/finance/budgets/${id}/status`, { status });
      setSelected(null);
      setLines([]);
      setVs([]);
      router.refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const setLine = (i: number, patch: Partial<Line>) => setLines((l) => l.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));

  return (
    <div className="space-y-4">
      {error && <p role="alert" className="text-label text-danger">{error}</p>}
      <div className="grid grid-cols-3 gap-4 max-lg:grid-cols-1">
        <Card className="self-start">
          <CardTitle action={<span className="text-label text-ink-3">{budgets.length}</span>}>Presupuestos</CardTitle>
          <div className="mb-3 space-y-2">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre" aria-label="Nombre del presupuesto" />
            <div className="flex gap-2">
              <Input type="number" value={year} onChange={(e) => setYear(e.target.value)} placeholder="Año fiscal" aria-label="Año fiscal" />
              <Button size="sm" loading={busy} disabled={busy || !name.trim() || !year} onClick={createBudget}>
                Crear
              </Button>
            </div>
          </div>
          {budgets.length === 0 ? (
            <p className="py-2 text-center text-label text-ink-3">Sin presupuestos.</p>
          ) : (
            <ul className="space-y-1">
              {budgets.map((b) => (
                <li key={b.id} className="flex items-center gap-2">
                  <button className={`flex-1 rounded px-2 py-1.5 text-left text-body hover:bg-sunken ${selected?.id === b.id ? 'bg-sunken' : ''}`} onClick={() => selectBudget(b)}>
                    {b.name} <span className="text-label text-ink-3">{b.fiscal_year}</span>
                  </button>
                  <span className="rounded-full bg-subtle px-2 py-0.5 text-caption font-medium text-ink-2">{STATUS[b.status] ?? b.status}</span>
                  {(ACTIONS[b.status] ?? []).map(([to, label]) => (
                    <Button key={to} variant="secondary" size="sm" loading={busy} disabled={busy} onClick={() => transition(b.id, to)}>
                      {label}
                    </Button>
                  ))}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="col-span-2 self-start max-lg:col-span-3">
          <CardTitle>Líneas {selected ? `· ${selected.name}` : ''}</CardTitle>
          {!selected ? (
            <p className="py-3 text-center text-label text-ink-3">Elegí un presupuesto para editar sus líneas.</p>
          ) : !editable ? (
            <p className="text-label text-ink-3">Solo se editan las líneas de un presupuesto en borrador. ({lines.length} líneas)</p>
          ) : (
            <div className="space-y-2">
              {lines.map((l, i) => (
                <div key={i} className="flex gap-1">
                  <Select value={l.account_id} onChange={(e) => setLine(i, { account_id: e.target.value })} controlSize="sm" aria-label={`Cuenta línea ${i + 1}`}>
                    <option value="">Cuenta…</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.code} · {a.name}
                      </option>
                    ))}
                  </Select>
                  <Select value={l.month} onChange={(e) => setLine(i, { month: e.target.value })} controlSize="sm" aria-label={`Mes línea ${i + 1}`} fullWidth={false}>
                    <option value="">Mes…</option>
                    {MONTHS.map((m, idx) => (
                      <option key={m} value={idx + 1}>
                        {m}
                      </option>
                    ))}
                  </Select>
                  <Input type="number" value={l.amount} onChange={(e) => setLine(i, { amount: e.target.value })} placeholder="Monto" aria-label={`Monto línea ${i + 1}`} />
                  <Button variant="secondary" size="sm" onClick={() => setLines((x) => x.filter((_, idx) => idx !== i))} aria-label={`Quitar línea ${i + 1}`}>
                    ✕
                  </Button>
                </div>
              ))}
              <div className="flex justify-between border-t border-subtle pt-2">
                <Button variant="secondary" size="sm" onClick={() => setLines((l) => [...l, { account_id: '', cost_center_id: '', month: '', amount: '' }])}>
                  + Línea
                </Button>
                <Button size="sm" loading={busy} disabled={busy} onClick={saveLines}>
                  Guardar líneas
                </Button>
              </div>
            </div>
          )}
        </Card>
      </div>

      {selected && (
        <Card>
          <CardTitle>Presupuesto vs real · {selected.fiscal_year}</CardTitle>
          {vs.length === 0 ? (
            <p className="py-3 text-center text-label text-ink-3">Sin datos: cargá líneas o registrá asientos del año.</p>
          ) : (
            <table className="w-full text-body">
              <thead>
                <tr className="h-8 border-b border-subtle text-left text-caption font-medium tracking-[0.06em] text-ink-3 uppercase">
                  <th>Cuenta</th>
                  <th className="text-right">Presupuesto</th>
                  <th className="text-right">Real</th>
                  <th className="text-right">Desvío</th>
                  <th className="text-right">%</th>
                </tr>
              </thead>
              <tbody>
                {vs.map((r) => (
                  <tr key={r.account_id} className="h-8 border-b border-subtle last:border-0">
                    <td>
                      <span className="text-ink-3">{r.account_code}</span> {r.account_name}
                    </td>
                    <td className="tnum text-right">{r.budget}</td>
                    <td className="tnum text-right">{r.actual}</td>
                    <td className={`tnum text-right font-medium ${r.variance === 0 ? '' : isBad(r) ? 'text-danger' : 'text-success'}`}>{r.variance}</td>
                    <td className="tnum text-right text-ink-3">{r.variance_pct == null ? '—' : `${Math.round(r.variance_pct * 100)}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}
    </div>
  );
}
