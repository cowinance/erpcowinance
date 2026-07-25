'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { API_URL, authHeaders } from '@/lib/api';
import { Card, CardTitle } from '@/components/ui';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Select } from '@/components/Select';

interface Animal {
  id: string;
  tag: string | null;
  name: string | null;
}
interface DayRow {
  production_date: string;
  cows: number;
  total_liters: number;
  avg_liters_per_cow: number;
}
interface Delivery {
  id: string;
  delivered_at: string;
  liters: number;
  buyer_name: string | null;
  amount: number | null;
}
interface Quality {
  id: string;
  sample_date: string;
  fat_pct: number | null;
  protein_pct: number | null;
  scc: number | null;
  tank_name: string | null;
  animal_id: string | null;
}

const TABS: [string, string][] = [
  ['prod', 'Producción'],
  ['deliv', 'Entregas'],
  ['qual', 'Calidad'],
];

export function TamboView({ byDay, tanks, deliveries, quality, animals }: { byDay: DayRow[]; tanks: { id: string; name: string }[]; deliveries: Delivery[]; quality: Quality[]; animals: Animal[] }) {
  const router = useRouter();
  const [tab, setTab] = useState<'prod' | 'deliv' | 'qual'>('prod');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Producción
  const [animalId, setAnimalId] = useState('');
  const [date, setDate] = useState('');
  const [liters, setLiters] = useState('');

  async function post(path: string, data: any, reset: () => void) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`${API_URL}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify(data) });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.title ?? `Error ${res.status}`);
      }
      reset();
      router.refresh();
    } catch (e: any) {
      setError(e.message ?? 'No se pudo guardar.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <nav className="tab-strip flex gap-1 border-b border-subtle">
        {TABS.map(([k, label]) => (
          <button key={k} onClick={() => setTab(k as any)} className={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-body font-medium ${tab === k ? 'border-brand text-brand' : 'border-transparent text-ink-3 hover:text-ink-1'}`}>
            {label}
          </button>
        ))}
      </nav>
      {error && <p role="alert" className="text-label text-danger">{error}</p>}

      {tab === 'prod' && (
        <div className="grid grid-cols-3 gap-4 max-lg:grid-cols-1">
          <Card className="self-start">
            <CardTitle>Cargar producción</CardTitle>
            {animals.length === 0 ? (
              <p className="text-label text-ink-3">No hay vacas activas.</p>
            ) : (
              <div className="space-y-2">
                <Select value={animalId} onChange={(e) => setAnimalId(e.target.value)} aria-label="Vaca">
                  <option value="">Elegí vaca…</option>
                  {animals.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.tag ?? a.name ?? a.id.slice(0, 8)}
                    </option>
                  ))}
                </Select>
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Fecha de producción" />
                <Input type="number" value={liters} onChange={(e) => setLiters(e.target.value)} placeholder="Litros" aria-label="Litros" />
                <Button size="sm" fullWidth loading={busy} disabled={busy || !animalId || !date || !liters} onClick={() => post('/dairy/production', { animal_id: animalId, production_date: date, total_liters: Number(liters) }, () => setLiters(''))}>
                  Cargar
                </Button>
              </div>
            )}
          </Card>
          <Card className="col-span-2 self-start max-lg:col-span-3">
            <CardTitle>Producción del tambo (por día)</CardTitle>
            {byDay.length === 0 ? (
              <p className="py-3 text-center text-label text-ink-3">Sin producción cargada.</p>
            ) : (
              <table className="w-full text-body">
                <thead>
                  <tr className="h-8 border-b border-subtle text-left text-caption font-medium tracking-[0.06em] text-ink-3 uppercase">
                    <th>Día</th>
                    <th className="text-right">Vacas</th>
                    <th className="text-right">Litros</th>
                    <th className="text-right">Prom./vaca</th>
                  </tr>
                </thead>
                <tbody>
                  {byDay.map((d) => (
                    <tr key={d.production_date} className="h-8 border-b border-subtle last:border-0">
                      <td>{d.production_date}</td>
                      <td className="tnum text-right">{d.cows}</td>
                      <td className="tnum text-right font-medium">{d.total_liters}</td>
                      <td className="tnum text-right text-ink-3">{d.avg_liters_per_cow}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>
      )}

      {tab === 'deliv' && (
        <Card>
          <CardTitle action={<span className="text-label text-ink-3">{deliveries.length}</span>}>Entregas</CardTitle>
          {deliveries.length === 0 ? (
            <p className="py-3 text-center text-label text-ink-3">Sin entregas.</p>
          ) : (
            <table className="w-full text-body">
              <thead>
                <tr className="h-8 border-b border-subtle text-left text-caption font-medium tracking-[0.06em] text-ink-3 uppercase">
                  <th>Fecha</th>
                  <th>Comprador</th>
                  <th className="text-right">Litros</th>
                  <th className="text-right">Importe</th>
                </tr>
              </thead>
              <tbody>
                {deliveries.map((d) => (
                  <tr key={d.id} className="h-8 border-b border-subtle last:border-0">
                    <td className="text-ink-3">{d.delivered_at?.slice(0, 10)}</td>
                    <td>{d.buyer_name ?? '—'}</td>
                    <td className="tnum text-right">{d.liters}</td>
                    <td className="tnum text-right font-medium">{d.amount ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}

      {tab === 'qual' && (
        <Card>
          <CardTitle action={<span className="text-label text-ink-3">{quality.length}</span>}>Calidad</CardTitle>
          {quality.length === 0 ? (
            <p className="py-3 text-center text-label text-ink-3">Sin tests de calidad.</p>
          ) : (
            <table className="w-full text-body">
              <thead>
                <tr className="h-8 border-b border-subtle text-left text-caption font-medium tracking-[0.06em] text-ink-3 uppercase">
                  <th>Fecha</th>
                  <th>Muestra</th>
                  <th className="text-right">Grasa %</th>
                  <th className="text-right">Proteína %</th>
                  <th className="text-right">RCS</th>
                </tr>
              </thead>
              <tbody>
                {quality.map((q) => (
                  <tr key={q.id} className="h-8 border-b border-subtle last:border-0">
                    <td className="text-ink-3">{q.sample_date}</td>
                    <td>{q.tank_name ? `Tanque ${q.tank_name}` : 'Animal'}</td>
                    <td className="tnum text-right">{q.fat_pct ?? '—'}</td>
                    <td className="tnum text-right">{q.protein_pct ?? '—'}</td>
                    <td className="tnum text-right">{q.scc ?? '—'}</td>
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
