'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { API_URL, authHeaders } from '@/lib/api';
import { Card, CardTitle } from '@/components/ui';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Select } from '@/components/Select';

interface Carcass {
  id: string;
  animal_tag: string | null;
  slaughter_date: string;
  hot_carcass_weight_kg: number;
  dressing_pct: number | null;
}
interface Animal {
  id: string;
  tag: string | null;
  name: string | null;
}
interface AnalyticsRow {
  group_id: string;
  group_label: string | null;
  count: number;
  avg_dressing_pct: number | null;
  avg_carcass_kg: number | null;
}

export function FaenaView({ carcasses, animals, byLot, bySire }: { carcasses: Carcass[]; animals: Animal[]; byLot: AnalyticsRow[]; bySire: AnalyticsRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [animalId, setAnimalId] = useState('');
  const [date, setDate] = useState('');
  const [weight, setWeight] = useState('');
  const [conformation, setConformation] = useState('');
  const [by, setBy] = useState<'lot' | 'sire'>('lot');

  const rows = by === 'lot' ? byLot : bySire;

  async function record() {
    if (busy || !animalId || !date || !weight) return;
    setBusy(true);
    setError('');
    setInfo('');
    try {
      const res = await fetch(`${API_URL}/slaughter/carcasses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ animal_id: animalId, slaughter_date: date, hot_carcass_weight_kg: Number(weight), conformation: conformation || undefined }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(j?.title ?? `Error ${res.status}`);
      setInfo(j?.dressing_pct != null ? `Rendimiento ${j.dressing_pct}% (peso vivo ${j.live_weight_kg} kg).` : 'Registrada. Sin pesadas: rendimiento no calculable.');
      setWeight('');
      setConformation('');
      router.refresh();
    } catch (e: any) {
      setError(e.message ?? 'No se pudo guardar.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid grid-cols-3 gap-4 max-lg:grid-cols-1">
      <Card className="self-start">
        <CardTitle>Registrar faena</CardTitle>
        {error && <p role="alert" className="mb-2 text-label text-danger">{error}</p>}
        {info && <p className="mb-2 text-label text-success">{info}</p>}
        {animals.length === 0 ? (
          <p className="text-label text-ink-3">No hay animales vendidos para faenar.</p>
        ) : (
          <div className="space-y-2">
            <Select value={animalId} onChange={(e) => setAnimalId(e.target.value)} aria-label="Animal">
              <option value="">Elegí animal…</option>
              {animals.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.tag ?? a.name ?? a.id.slice(0, 8)}
                </option>
              ))}
            </Select>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Fecha de faena" />
            <Input type="number" value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="Peso de res (kg)" aria-label="Peso de res" />
            <Input value={conformation} onChange={(e) => setConformation(e.target.value)} placeholder="Conformación (opcional)" aria-label="Conformación" />
            <Button size="sm" fullWidth loading={busy} disabled={busy || !animalId || !date || !weight} onClick={record}>
              Registrar
            </Button>
          </div>
        )}
      </Card>

      <Card className="col-span-2 self-start max-lg:col-span-3">
        <CardTitle action={<span className="text-label text-ink-3">{carcasses.length}</span>}>Reses</CardTitle>
        {carcasses.length === 0 ? (
          <p className="py-3 text-center text-label text-ink-3">Sin faenas registradas.</p>
        ) : (
          <table className="w-full text-body">
            <thead>
              <tr className="h-8 border-b border-subtle text-left text-caption font-medium tracking-[0.06em] text-ink-3 uppercase">
                <th>Animal</th>
                <th>Fecha</th>
                <th className="text-right">Res (kg)</th>
                <th className="text-right">Rendimiento</th>
              </tr>
            </thead>
            <tbody>
              {carcasses.map((c) => (
                <tr key={c.id} className="h-8 border-b border-subtle last:border-0">
                  <td>{c.animal_tag ?? c.id.slice(0, 8)}</td>
                  <td className="text-ink-3">{c.slaughter_date}</td>
                  <td className="tnum text-right">{c.hot_carcass_weight_kg}</td>
                  <td className="tnum text-right font-medium">{c.dressing_pct == null ? '—' : `${c.dressing_pct}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card className="col-span-3">
        <CardTitle
          action={
            <div className="flex gap-1">
              <Button variant={by === 'lot' ? 'primary' : 'secondary'} size="sm" onClick={() => setBy('lot')}>
                Por lote
              </Button>
              <Button variant={by === 'sire' ? 'primary' : 'secondary'} size="sm" onClick={() => setBy('sire')}>
                Por padre
              </Button>
            </div>
          }
        >
          Rendimiento {by === 'lot' ? 'por lote' : 'por padre'}
        </CardTitle>
        {rows.length === 0 ? (
          <p className="py-3 text-center text-label text-ink-3">Sin datos: registrá faenas de animales con {by === 'lot' ? 'lote' : 'padre'} asignado.</p>
        ) : (
          <table className="w-full text-body">
            <thead>
              <tr className="h-8 border-b border-subtle text-left text-caption font-medium tracking-[0.06em] text-ink-3 uppercase">
                <th>{by === 'lot' ? 'Lote' : 'Padre'}</th>
                <th className="text-right">Reses</th>
                <th className="text-right">Rend. prom.</th>
                <th className="text-right">Res prom. (kg)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.group_id} className="h-8 border-b border-subtle last:border-0">
                  <td>{r.group_label ?? r.group_id.slice(0, 8)}</td>
                  <td className="tnum text-right">{r.count}</td>
                  <td className="tnum text-right font-medium">{r.avg_dressing_pct == null ? '—' : `${r.avg_dressing_pct}%`}</td>
                  <td className="tnum text-right">{r.avg_carcass_kg ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
