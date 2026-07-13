'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { API_URL, authHeaders } from '@/lib/api';
import { Card, CardTitle } from '@/components/ui';
import { Button } from '@/components/Button';
import { Select } from '@/components/Select';

interface Plan {
  id: string;
  code: string;
  name: string;
  monthly_price_usd: number;
  max_animals: number | null;
  max_users: number | null;
  max_devices: number | null;
}
interface Subscription {
  status: string;
  billing_currency: string;
  current_period_start: string;
  current_period_end: string;
  plan: { id: string; code: string; name: string; monthly_price_usd: number };
  limits: { animals: number | null; users: number | null; devices: number | null };
  usage: { animals: number; users: number; devices: number };
}

const STATUS: Record<string, { label: string; cls: string }> = {
  trialing: { label: 'Prueba', cls: 'text-info' },
  active: { label: 'Activa', cls: 'text-success' },
  past_due: { label: 'Pago pendiente', cls: 'text-warning' },
  canceled: { label: 'Cancelada', cls: 'text-danger' },
};

const fmtDate = (s: string) => (s ? new Date(String(s).slice(0, 10) + 'T00:00:00Z').toLocaleDateString('es-AR', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const limitLabel = (used: number, limit: number | null) => (limit == null ? `${used} · sin límite` : `${used} / ${limit}`);
const over = (used: number, limit: number | null) => limit != null && used > limit;

export function SubscriptionView({ subscription: sub, plans }: { subscription: Subscription; plans: Plan[] }) {
  const router = useRouter();
  const [planCode, setPlanCode] = useState(sub.plan.code);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const st = STATUS[sub.status] ?? { label: sub.status, cls: 'text-ink-2' };

  async function changePlan() {
    if (busy || planCode === sub.plan.code) return;
    setBusy(true);
    setError('');
    setFeedback('');
    try {
      const res = await fetch(`${API_URL}/billing/subscription`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ plan_code: planCode }),
      });
      if (res.status === 403) throw new Error('Solo el propietario o un administrador puede cambiar el plan.');
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.title ?? `Error ${res.status}`);
      }
      setFeedback('Plan actualizado.');
      router.refresh();
    } catch (e: any) {
      setError(e.message ?? 'No se pudo cambiar el plan.');
    } finally {
      setBusy(false);
    }
  }

  const rows: [string, number, number | null][] = [
    ['Animales', sub.usage.animals, sub.limits.animals],
    ['Usuarios', sub.usage.users, sub.limits.users],
    ['Dispositivos', sub.usage.devices, sub.limits.devices],
  ];

  return (
    <div className="grid grid-cols-5 gap-4 max-lg:grid-cols-1">
      {/* Plan actual + uso */}
      <Card className="col-span-3">
        <CardTitle action={<span className={`text-label font-medium ${st.cls}`}>{st.label}</span>}>Plan actual</CardTitle>
        <div className="mb-3 flex items-baseline gap-2">
          <span className="text-compat-26 font-semibold">{sub.plan.name}</span>
          <span className="text-label text-ink-3">
            US$ {sub.plan.monthly_price_usd}/mes · período {fmtDate(sub.current_period_start)} → {fmtDate(sub.current_period_end)}
          </span>
        </div>
        <div className="space-y-2">
          {rows.map(([label, used, limit]) => (
            <div key={label} className="flex items-center justify-between text-body">
              <span className="text-ink-2">{label}</span>
              <span className={`tnum font-medium ${over(used, limit) ? 'text-warning' : 'text-ink'}`}>{limitLabel(used, limit)}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* Cambiar plan (sin cobro) */}
      <Card className="col-span-2 self-start max-lg:col-span-3">
        <CardTitle>Cambiar plan</CardTitle>
        {feedback && (
          <p role="status" className="mb-2 text-label text-success">
            {feedback}
          </p>
        )}
        {error && (
          <p role="alert" className="mb-2 text-label text-danger">
            {error}
          </p>
        )}
        <label className="mb-3 block">
          <span className="mb-1 block text-caption font-medium text-ink-2">Plan</span>
          <Select value={planCode} onChange={(e) => setPlanCode(e.target.value)} aria-label="Elegir plan">
            {plans.map((p) => (
              <option key={p.id} value={p.code}>
                {p.name} — US$ {p.monthly_price_usd}/mes
              </option>
            ))}
          </Select>
        </label>
        <Button onClick={changePlan} loading={busy} disabled={busy || planCode === sub.plan.code} fullWidth>
          {busy ? 'Actualizando…' : 'Cambiar plan'}
        </Button>
        <p className="mt-2 text-caption text-ink-3">El cambio de plan no procesa cobros. El pago se gestiona por fuera (proveedor de pagos).</p>
      </Card>
    </div>
  );
}
