'use client';

import { useState } from 'react';
import { API_URL, authHeaders } from '@/lib/api';
import { Card, CardTitle, KpiCard } from '@/components/ui';
import { Input } from '@/components/Input';

interface Summary {
  period: { from: string; to: string };
  counts: {
    serviced_females: number;
    pregnancies: number;
    weanings: number;
    avg_weaning_kg: number | null;
    breeding_cows: number;
    replacement_heifers: number;
    total_ha: number;
    age_first_service_months: number | null;
  };
  pregnancy_rate: number | null;
  weaning_rate: number | null;
  replacement_rate: number | null;
  kg_weaned_per_ha: number | null;
}

const fmt = (n: number | null | undefined, digits = 1, dash = '—') =>
  n == null ? dash : n.toLocaleString('es-AR', { maximumFractionDigits: digits });

export function BreedingView({ initial, from: from0, to: to0 }: { initial: Summary; from: string; to: string }) {
  const [data, setData] = useState<Summary>(initial);
  const [from, setFrom] = useState(from0);
  const [to, setTo] = useState(to0);

  async function reload(f: string, t: string) {
    const res = await fetch(`${API_URL}/breeding/summary?from=${f}&to=${t}`, { headers: authHeaders() });
    if (res.ok) setData(await res.json());
  }

  const c = data.counts;
  return (
    <div className="space-y-5">
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-label text-ink-2">
            Desde
            <div className="mt-1 w-40">
              <Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); reload(e.target.value, to); }} />
            </div>
          </label>
          <label className="text-label text-ink-2">
            Hasta
            <div className="mt-1 w-40">
              <Input type="date" value={to} onChange={(e) => { setTo(e.target.value); reload(from, e.target.value); }} />
            </div>
          </label>
        </div>
      </Card>

      <div className="grid grid-cols-4 gap-4 max-lg:grid-cols-2 max-sm:grid-cols-1">
        <KpiCard label="Destete / vientre entorado" value={fmt(data.weaning_rate, 3)} hint="Ternero destetado por vaca entorada" />
        <KpiCard label="Kg destetados / ha" value={fmt(data.kg_weaned_per_ha)} unit="kg" hint={`${fmt(c.total_ha)} ha en producción`} />
        <KpiCard label="Preñez" value={data.pregnancy_rate == null ? '—' : fmt(data.pregnancy_rate)} unit={data.pregnancy_rate == null ? '' : '%'} hint="Preñeces sobre entoradas" />
        <KpiCard label="Reposición" value={data.replacement_rate == null ? '—' : fmt(data.replacement_rate)} unit={data.replacement_rate == null ? '' : '%'} hint="Vaquillonas sobre vacas" />
      </div>

      <Card>
        <CardTitle>Rodeo de cría</CardTitle>
        <div className="grid grid-cols-3 gap-4 max-sm:grid-cols-2">
          <Stat label="Vientres entorados" value={fmt(c.serviced_females, 0)} />
          <Stat label="Preñeces" value={fmt(c.pregnancies, 0)} />
          <Stat label="Destetes" value={fmt(c.weanings, 0)} />
          <Stat label="Peso prom. al destete" value={fmt(c.avg_weaning_kg, 0)} unit="kg" />
          <Stat label="Edad al 1er servicio" value={fmt(c.age_first_service_months)} unit="meses" />
          <Stat label="Vacas / vaquillonas" value={`${fmt(c.breeding_cows, 0)} / ${fmt(c.replacement_heifers, 0)}`} />
        </div>
      </Card>
    </div>
  );
}

function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div>
      <div className="text-caption text-ink-3">{label}</div>
      <div className="tnum text-body font-semibold">
        {value}
        {unit && <span className="ml-0.5 text-caption font-normal text-ink-3">{unit}</span>}
      </div>
    </div>
  );
}
