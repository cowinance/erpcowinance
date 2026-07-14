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

const ROLES: [string, string][] = [
  ['receivable', 'Clientes (deudores)'],
  ['sales_income', 'Ventas (ingreso)'],
  ['vat_debit', 'IVA débito'],
  ['purchases', 'Compras (gasto/inventario)'],
  ['vat_credit', 'IVA crédito'],
  ['payable', 'Proveedores'],
  ['cash', 'Caja (efectivo)'],
];

export function ConfigView({ accounts, map, banks }: { accounts: Account[]; map: Record<string, string>; banks: { id: string; name: string; currency: string; ledger_account_code: string | null }[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [roles, setRoles] = useState<Record<string, string>>(map);
  const [bName, setBName] = useState('');
  const [bCurrency, setBCurrency] = useState('ARS');
  const [bLedger, setBLedger] = useState('');

  async function call(method: string, path: string, data: any, ok: () => void) {
    if (busy) return;
    setBusy(true);
    setError('');
    setInfo('');
    try {
      const res = await fetch(`${API_URL}${path}`, { method, headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify(data) });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.title ?? `Error ${res.status}`);
      }
      ok();
    } catch (e: any) {
      setError(e.message ?? 'No se pudo guardar.');
    } finally {
      setBusy(false);
    }
  }

  const saveMap = () =>
    call('PUT', '/finance/posting-accounts', Object.fromEntries(Object.entries(roles).filter(([, v]) => v)), () => {
      setInfo('Mapa de posteo guardado.');
      router.refresh();
    });
  const addBank = () => call('POST', '/finance/bank-accounts', { name: bName, currency: bCurrency, ledger_account_id: bLedger || undefined }, () => { setBName(''); router.refresh(); });

  return (
    <div className="grid grid-cols-2 gap-4 max-lg:grid-cols-1">
      <Card className="self-start">
        <CardTitle>Mapa de cuentas de posteo</CardTitle>
        {error && <p role="alert" className="mb-2 text-label text-danger">{error}</p>}
        {info && <p className="mb-2 text-label text-success">{info}</p>}
        <div className="space-y-2">
          {ROLES.map(([role, label]) => (
            <label key={role} className="flex items-center justify-between gap-2 text-label">
              <span className="text-ink-2">{label}</span>
              <Select value={roles[role] ?? ''} onChange={(e) => setRoles((r) => ({ ...r, [role]: e.target.value }))} controlSize="sm" aria-label={`Cuenta rol ${role}`} fullWidth={false}>
                <option value="">—</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} · {a.name}
                  </option>
                ))}
              </Select>
            </label>
          ))}
          <Button size="sm" fullWidth loading={busy} disabled={busy} onClick={saveMap}>
            Guardar mapa
          </Button>
        </div>
      </Card>

      <Card className="self-start">
        <CardTitle action={<span className="text-label text-ink-3">{banks.length}</span>}>Cuentas bancarias</CardTitle>
        <div className="mb-3 space-y-2">
          <Input value={bName} onChange={(e) => setBName(e.target.value)} placeholder="Nombre (p.ej. Cta Cte $)" aria-label="Nombre de la cuenta bancaria" />
          <div className="flex gap-2">
            <Input value={bCurrency} onChange={(e) => setBCurrency(e.target.value)} placeholder="Moneda" aria-label="Moneda" fullWidth={false} />
            <Select value={bLedger} onChange={(e) => setBLedger(e.target.value)} controlSize="sm" aria-label="Cuenta contable del banco">
              <option value="">Cuenta contable…</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} · {a.name}
                </option>
              ))}
            </Select>
          </div>
          <Button size="sm" fullWidth loading={busy} disabled={busy} onClick={addBank}>
            Agregar cuenta bancaria
          </Button>
        </div>
        {banks.length === 0 ? (
          <p className="py-2 text-center text-label text-ink-3">Sin cuentas bancarias.</p>
        ) : (
          <ul className="space-y-1">
            {banks.map((b) => (
              <li key={b.id} className="flex justify-between text-label">
                <span>{b.name}</span>
                <span className="text-ink-3">{b.ledger_account_code ?? b.currency}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
