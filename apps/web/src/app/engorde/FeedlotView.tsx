'use client';

import { useState } from 'react';
import { API_URL, authHeaders } from '@/lib/api';
import { Card, CardTitle, EmptyState } from '@/components/ui';
import { Input } from '@/components/Input';

interface Lot {
  id: string;
  name: string;
  head: number;
  feed_kg: number;
  feed_cost: number;
  kg_gained: number;
  avg_weight_kg: number | null;
  avg_adg: number | null;
  conversion: number | null;
  cost_per_kg_gained: number | null;
  days_to_finish: number | null;
}

const fmt = (n: number | null, digits = 1) => (n == null ? '—' : n.toLocaleString('es-AR', { maximumFractionDigits: digits }));

function Metric({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div>
      <div className="text-caption text-ink-3">{label}</div>
      <div className="tnum text-body font-semibold">
        {value}
        {/* La unidad solo acompaña a un número. Con el dato ausente daba «—kg/kg», que se lee como
            un número raro en vez de como «no se sabe» — y desde que los ceros falsos pasaron a «—»
            este caso dejó de ser excepcional. */}
        {unit && value !== '—' && <span className="ml-0.5 text-caption font-normal text-ink-3">{unit}</span>}
      </div>
    </div>
  );
}

export function FeedlotView({ initial }: { initial: Lot[] }) {
  const [lots, setLots] = useState<Lot[]>(initial);
  const [target, setTarget] = useState('');

  async function applyTarget(value: string) {
    setTarget(value);
    const q = value && Number(value) > 0 ? `?target=${Number(value)}` : '';
    const res = await fetch(`${API_URL}/feedlot/lots${q}`, { headers: authHeaders() });
    if (res.ok) setLots(await res.json());
  }

  if (lots.length === 0) {
    return <EmptyState title="Sin corrales de engorde" body="Marcá un lote con destino «engorde» (purpose fattening) y cargá pesajes y entregas de alimento." />;
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-body font-medium">Peso objetivo de terminación</span>
          <div className="w-32">
            <Input type="number" value={target} onChange={(e) => applyTarget(e.target.value)} placeholder="kg" aria-label="Peso objetivo (kg)" min="0" />
          </div>
          <span className="text-label text-ink-3">Fija los días a terminación proyectados por corral.</span>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-4 max-lg:grid-cols-1">
        {lots.map((l) => (
          <Card key={l.id}>
            <CardTitle action={<span className="text-label text-ink-3">{l.head} cab.</span>}>{l.name}</CardTitle>
            <div className="grid grid-cols-3 gap-3">
              <Metric label="Peso prom." value={fmt(l.avg_weight_kg)} unit="kg" />
              <Metric label="GDP corral" value={fmt(l.avg_adg, 2)} unit="kg/d" />
              <Metric label="Kg ganados" value={fmt(l.kg_gained)} unit="kg" />
              <Metric label="Conversión" value={fmt(l.conversion, 2)} unit="kg/kg" />
              <Metric label="Costo/kg ganado" value={fmt(l.cost_per_kg_gained, 2)} />
              <Metric label="Días a terminar" value={l.days_to_finish == null ? '—' : String(l.days_to_finish)} unit={l.days_to_finish == null ? '' : 'd'} />
            </div>
            <div className="mt-3 border-t border-subtle pt-2 text-caption text-ink-3">
              Alimento: <span className="tnum">{fmt(l.feed_kg)}</span> kg · costo <span className="tnum">{fmt(l.feed_cost)}</span>
              {/* Un guion solo no dice qué hacer. Antes acá había un 0 que mentía; cambiarlo por «—»
                  arregla la mentira pero deja al productor sin saber por qué, así que se nombra lo
                  que falta y dónde se carga. */}
              {!l.feed_kg ? (
                <span className="text-warning"> · sin entregas de alimento cargadas, por eso no hay conversión ni costo del kilo</span>
              ) : !l.feed_cost ? (
                <span className="text-warning"> · las entregas no tienen costo cargado, por eso no hay costo del kilo</span>
              ) : null}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
