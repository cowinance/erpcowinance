'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { API_URL, authHeaders } from '@/lib/api';
import { Card, CardTitle } from '@/components/ui';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Select } from '@/components/Select';

interface Account {
  id: string;
  code: string;
  name: string;
}
interface Entry {
  id: string;
  entry_date: string;
  reference: string | null;
  status: string;
  total: number;
}
interface Line {
  account_id: string;
  debit: string;
  credit: string;
}

const emptyLine = (): Line => ({ account_id: '', debit: '', credit: '' });
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function JournalView({ journal, accounts }: { journal: Entry[]; accounts: Account[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [date, setDate] = useState('');
  const [reference, setReference] = useState('');
  const [lines, setLines] = useState<Line[]>([emptyLine(), emptyLine()]);

  const setLine = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const totalDebit = round2(lines.reduce((s, l) => s + (Number(l.debit) || 0), 0));
  const totalCredit = round2(lines.reduce((s, l) => s + (Number(l.credit) || 0), 0));
  const balanced = totalDebit > 0 && totalDebit === totalCredit;

  async function call(method: string, path: string, data?: any) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`${API_URL}${path}`, { method, headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: data ? JSON.stringify(data) : undefined });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.title ?? `Error ${res.status}`);
      }
      return true;
    } catch (e: any) {
      setError(e.message ?? 'No se pudo guardar.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    if (!date) return setError('Elegí la fecha del asiento.');
    const payloadLines = lines
      .filter((l) => l.account_id && (Number(l.debit) > 0 || Number(l.credit) > 0))
      .map((l) => ({ account_id: l.account_id, debit: Number(l.debit) || 0, credit: Number(l.credit) || 0 }));
    if (payloadLines.length < 2) return setError('El asiento necesita al menos 2 líneas.');
    const ok = await call('POST', '/finance/journal', { entry_date: date, reference: reference || undefined, lines: payloadLines });
    if (ok) {
      setLines([emptyLine(), emptyLine()]);
      setReference('');
      router.refresh();
    }
  }

  async function reverse(id: string) {
    const ok = await call('POST', `/finance/journal/${id}/reverse`, {});
    if (ok) router.refresh();
  }

  return (
    <div className="grid grid-cols-3 gap-4 max-lg:grid-cols-1">
      {/* Alta */}
      <Card className="self-start">
        <CardTitle>Nuevo asiento</CardTitle>
        {error && (
          <p role="alert" className="mb-2 text-label text-danger">
            {error}
          </p>
        )}
        <div className="space-y-2">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Fecha del asiento" />
          <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Concepto (opcional)" aria-label="Concepto" />
          <div className="space-y-1 border-t border-subtle pt-2">
            {lines.map((l, i) => (
              <div key={i} className="space-y-1">
                <Select value={l.account_id} onChange={(e) => setLine(i, { account_id: e.target.value })} controlSize="sm" aria-label={`Cuenta línea ${i + 1}`}>
                  <option value="">Elegí cuenta…</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} · {a.name}
                    </option>
                  ))}
                </Select>
                <div className="flex gap-1">
                  <Input type="number" value={l.debit} onChange={(e) => setLine(i, { debit: e.target.value, credit: '' })} placeholder="Debe" aria-label={`Debe línea ${i + 1}`} />
                  <Input type="number" value={l.credit} onChange={(e) => setLine(i, { credit: e.target.value, debit: '' })} placeholder="Haber" aria-label={`Haber línea ${i + 1}`} />
                </div>
              </div>
            ))}
            <Button variant="secondary" size="sm" onClick={() => setLines((ls) => [...ls, emptyLine()])}>
              + Línea
            </Button>
          </div>
          <div className="flex items-center justify-between border-t border-subtle pt-2 text-label">
            <span className={balanced ? 'text-success' : 'text-ink-3'}>
              Debe <span className="tnum">{totalDebit}</span> · Haber <span className="tnum">{totalCredit}</span>
            </span>
            <Button size="sm" loading={busy} disabled={busy || !balanced} onClick={create}>
              Postear
            </Button>
          </div>
        </div>
      </Card>

      {/* Libro diario */}
      <Card className="col-span-2 self-start max-lg:col-span-3">
        <CardTitle action={<span className="text-label text-ink-3">{journal.length}</span>}>Libro diario</CardTitle>
        {journal.length === 0 ? (
          <p className="py-3 text-center text-label text-ink-3">Sin asientos.</p>
        ) : (
          <ul className="divide-y divide-subtle">
            {journal.map((e) => (
              <li key={e.id} className="flex items-center justify-between py-2">
                <div>
                  <span className="text-body">{e.reference ?? 'Asiento'}</span>
                  <span className="ml-2 text-label text-ink-3">{e.entry_date}</span>
                  <div className="tnum text-label text-ink-3">{e.total}</div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-caption font-medium ${e.status === 'reversed' ? 'bg-sunken text-ink-3' : 'bg-subtle text-ink-2'}`}>
                    {e.status === 'posted' ? 'Posteado' : e.status === 'reversed' ? 'Reversado' : e.status}
                  </span>
                  {e.status === 'posted' && (
                    <Button variant="secondary" size="sm" loading={busy} disabled={busy} onClick={() => reverse(e.id)}>
                      Reversar
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
