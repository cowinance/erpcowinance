'use client';

/**
 * Costos y consumo sanitario (Sanidad E5): costo de tratamientos + vacunaciones (por período / animal
 * / lote), consumo de medicamentos por producto y alertas de stock bajo/vencido. Deriva del costo real
 * ya persistido en cada aplicación (descontado del inventario) y de los movimientos de stock.
 */
import { useCallback, useEffect, useState } from 'react';
import { API_URL, authHeaders } from '@/lib/api';
import { AlertTriangle, DollarSign, Loader2, Package } from 'lucide-react';
import { Select } from '@/components/Select';

const cardCls = 'rounded-[10px] border border-subtle bg-surface p-5 shadow-[var(--shadow-1)]';
const money = (n: number) => (n ?? 0).toLocaleString('es-AR', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export function HealthCostsPanel() {
  const [by, setBy] = useState<'period' | 'animal' | 'lot'>('period');
  const [costs, setCosts] = useState<any[]>([]);
  const [consumption, setConsumption] = useState<any[]>([]);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [c, cons, al] = await Promise.all([
      fetch(`${API_URL}/health/costs?by=${by}`, { headers: authHeaders() }).then((r) => r.json()).catch(() => []),
      fetch(`${API_URL}/health/consumption`, { headers: authHeaders() }).then((r) => r.json()).catch(() => []),
      fetch(`${API_URL}/health/stock-alerts`, { headers: authHeaders() }).then((r) => r.json()).catch(() => []),
    ]);
    setCosts(Array.isArray(c) ? c : []);
    setConsumption(Array.isArray(cons) ? cons : []);
    setAlerts(Array.isArray(al) ? al : []);
    setLoading(false);
  }, [by]);

  useEffect(() => {
    load();
  }, [load]);

  const label = (r: any) => (by === 'period' ? r.period : by === 'animal' ? (r.tag ?? '—') : (r.lot_name ?? 'Sin lote'));

  return (
    <div className="mt-4 grid grid-cols-3 gap-4 max-lg:grid-cols-1">
      {/* Costo sanitario */}
      <div className={cardCls}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-subheading font-semibold">
            <DollarSign size={16} className="text-brand" /> Costo sanitario
          </h2>
          <Select value={by} onChange={(e) => setBy(e.target.value as any)} controlSize="sm" fullWidth={false}>
            <option value="period">Por mes</option>
            <option value="lot">Por lote</option>
            <option value="animal">Por animal</option>
          </Select>
        </div>
        {loading ? (
          <div className="flex justify-center py-6 text-ink-3"><Loader2 size={16} className="animate-spin" /></div>
        ) : costs.length === 0 ? (
          <p className="py-6 text-center text-body text-ink-3">Sin costos registrados.</p>
        ) : (
          <div className="max-h-72 space-y-1 overflow-y-auto">
            {costs.map((r, i) => (
              <div key={i} className="flex items-center justify-between text-label">
                <span className="truncate text-ink-2">{label(r)}</span>
                <span className="tnum shrink-0 font-medium">{money(r.cost)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Consumo de medicamentos */}
      <div className={cardCls}>
        <h2 className="mb-3 flex items-center gap-2 text-subheading font-semibold">
          <Package size={16} className="text-brand" /> Consumo de medicamentos
        </h2>
        {loading ? (
          <div className="flex justify-center py-6 text-ink-3"><Loader2 size={16} className="animate-spin" /></div>
        ) : consumption.length === 0 ? (
          <p className="py-6 text-center text-body text-ink-3">Sin consumo (enlazá productos a inventario).</p>
        ) : (
          <div className="max-h-72 space-y-1 overflow-y-auto">
            {consumption.map((r) => (
              <div key={r.product_id} className="flex items-center justify-between text-label">
                <span className="min-w-0 flex-1 truncate text-ink-2">{r.product}</span>
                <span className="tnum shrink-0 text-ink-3">{r.quantity} {r.unit} · {money(r.cost)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Alertas de stock */}
      <div className={cardCls}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-subheading font-semibold">
            <AlertTriangle size={16} className="text-warning" /> Alertas de stock
          </h2>
          <span className="text-label text-ink-3">{alerts.length}</span>
        </div>
        {loading ? (
          <div className="flex justify-center py-6 text-ink-3"><Loader2 size={16} className="animate-spin" /></div>
        ) : alerts.length === 0 ? (
          <p className="py-6 text-center text-body text-ink-3">Stock de medicamentos al día. 🎉</p>
        ) : (
          <div className="max-h-72 space-y-1 overflow-y-auto">
            {alerts.map((a) => (
              <div key={a.product_id} className="flex items-center gap-2 text-label">
                <span className="min-w-0 flex-1 truncate text-ink-2">{a.product}</span>
                <span className="tnum shrink-0 text-ink-3">{a.stock} {a.unit}</span>
                {a.is_expired && <span className="shrink-0 rounded bg-danger/10 px-1.5 py-0.5 text-caption text-danger">vencido</span>}
                {a.expiring_soon && !a.is_expired && <span className="shrink-0 rounded bg-warning/10 px-1.5 py-0.5 text-caption text-warning">por vencer</span>}
                {a.is_low && <span className="shrink-0 rounded bg-danger/10 px-1.5 py-0.5 text-caption text-danger">stock bajo</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
