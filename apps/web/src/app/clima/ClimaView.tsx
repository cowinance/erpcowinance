'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { API_URL, authHeaders } from '@/lib/api';
import { Card, CardTitle, EmptyState } from '@/components/ui';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Select } from '@/components/Select';
import { Field } from '@/components/Field';

interface Station {
  id: string;
  name: string;
  serial_number: string;
  status: string;
  last_seen_at: string | null;
  readings: number;
}

interface DayRow {
  date: string;
  tempMinC: number | null;
  tempMaxC: number | null;
  rainMm: number | null;
  humidityPct: number | null;
  thi: number | null;
  heat_stress: string | null;
}

interface Summary {
  from: string;
  to: string;
  days: number;
  daysWithoutData: number;
  rainMm: number | null;
  gdd: number | null;
  waterBalanceMm: number | null;
  tempMinC: number | null;
  tempMaxC: number | null;
  maxThi: number | null;
  maxHeatStress: string | null;
  frostDays: number;
  system: string;
  days_series: DayRow[];
}

const NIVEL: Record<string, { label: string; tone: string }> = {
  none: { label: 'Sin estrés', tone: 'text-ink-3' },
  mild: { label: 'Leve', tone: 'text-ink-2' },
  moderate: { label: 'Moderado', tone: 'text-warning' },
  severe: { label: 'Severo', tone: 'text-danger' },
  emergency: { label: 'Emergencia', tone: 'text-danger font-semibold' },
};

/** Las métricas que se cargan a mano: el parte del día. */
const CAMPOS = [
  { metric: 'temp_min', label: 'Mínima (°C)' },
  { metric: 'temp_max', label: 'Máxima (°C)' },
  { metric: 'humidity', label: 'Humedad (%)' },
  { metric: 'rain', label: 'Lluvia (mm)' },
  { metric: 'etp', label: 'ETP (mm)' },
] as const;

export function ClimaView({ summary, stations }: { summary: Summary; stations: Station[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [stationId, setStationId] = useState(stations[0]?.id ?? '');
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10));
  const [valores, setValores] = useState<Record<string, string>>({});
  const [nuevaEstacion, setNuevaEstacion] = useState({ name: '', serial_number: '' });

  async function call(path: string, data: unknown) {
    if (busy) return false;
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`${API_URL}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.title ?? `Error ${res.status}`);
      }
      router.refresh();
      return true;
    } catch (e: any) {
      setError(e.message ?? 'No se pudo guardar.');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function cargarParte() {
    const readings = CAMPOS.filter((c) => valores[c.metric]?.trim() !== '' && valores[c.metric] != null).map((c) => ({
      metric: c.metric,
      value: Number(valores[c.metric]),
      recorded_at: `${fecha}T12:00:00Z`,
    }));
    if (readings.length === 0) return setError('Cargá al menos una medición.');
    if (await call('/weather/readings', { station_id: stationId, readings })) setValores({});
  }

  if (stations.length === 0) {
    return (
      <div className="space-y-4">
        {error && <p role="alert" className="text-label text-danger">{error}</p>}
        <EmptyState
          title="Todavía no hay estaciones"
          body="Registrá una estación —propia o el pluviómetro del casco— para empezar a cargar el parte del día."
        />
        <Card className="max-w-md">
          <CardTitle>Nueva estación</CardTitle>
          <div className="mt-2 space-y-2">
            <Field label="Nombre" htmlFor="est-nombre">
              <Input
                id="est-nombre"
                value={nuevaEstacion.name}
                onChange={(e) => setNuevaEstacion({ ...nuevaEstacion, name: e.target.value })}
              />
            </Field>
            <Field label="Número de serie" htmlFor="est-serie">
              <Input
                id="est-serie"
                value={nuevaEstacion.serial_number}
                onChange={(e) => setNuevaEstacion({ ...nuevaEstacion, serial_number: e.target.value })}
              />
            </Field>
            <Button onClick={() => call('/weather/stations', nuevaEstacion)} disabled={busy || !nuevaEstacion.serial_number.trim()}>
              Registrar
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  const escala = summary.system === 'dairy' ? 'lechería' : 'carne';

  return (
    <div className="space-y-4">
      {error && <p role="alert" className="text-label text-danger">{error}</p>}

      {/* Los cuatro indicadores del catálogo. `—` cuando NO se midió: distinto de 0. */}
      <div className="grid grid-cols-4 gap-4 max-lg:grid-cols-2">
        <Kpi label="Lluvia acumulada" value={summary.rainMm} unit="mm" />
        <Kpi label="Grados-día (base 10)" value={summary.gdd} unit="°D" />
        <Kpi label="Balance hídrico" value={summary.waterBalanceMm} unit="mm" hint="lluvia − ETP" />
        <Card>
          <div className="text-label text-ink-3">Estrés calórico máximo</div>
          <div className={`mt-1 text-xl font-semibold ${NIVEL[summary.maxHeatStress ?? 'none']?.tone ?? ''}`}>
            {summary.maxHeatStress ? NIVEL[summary.maxHeatStress].label : '—'}
          </div>
          <div className="text-label text-ink-3">
            {summary.maxThi != null ? `THI ${summary.maxThi} · escala de ${escala}` : `escala de ${escala}`}
          </div>
        </Card>
      </div>

      {summary.daysWithoutData > 0 && (
        <p className="text-label text-ink-3">
          {summary.days} día{summary.days === 1 ? '' : 's'} con mediciones de {summary.days + summary.daysWithoutData}.
          Los días sin datos no se cuentan como cero.
        </p>
      )}

      <div className="grid grid-cols-3 gap-4 max-lg:grid-cols-1">
        <Card className="self-start">
          <CardTitle>Parte del día</CardTitle>
          <div className="mt-2 space-y-2">
            <Field label="Estación" htmlFor="estacion">
              <Select id="estacion" value={stationId} onChange={(e) => setStationId(e.target.value)}>
                {stations.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Fecha" htmlFor="fecha">
              <Input id="fecha" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
            </Field>
            {CAMPOS.map((c) => (
              <Field key={c.metric} label={c.label} htmlFor={`m-${c.metric}`}>
                <Input
                  id={`m-${c.metric}`}
                  type="number"
                  value={valores[c.metric] ?? ''}
                  onChange={(e) => setValores({ ...valores, [c.metric]: e.target.value })}
                />
              </Field>
            ))}
            <Button onClick={cargarParte} disabled={busy}>
              Cargar
            </Button>
          </div>
        </Card>

        <Card className="col-span-2 max-lg:col-span-1">
          <CardTitle>Últimos días</CardTitle>
          {summary.days_series.length === 0 ? (
            <p className="mt-2 text-label text-ink-3">Sin mediciones en el período.</p>
          ) : (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-body">
                <thead>
                  <tr className="text-label text-ink-3">
                    <th className="py-1 text-left font-medium">Fecha</th>
                    <th className="py-1 text-right font-medium">Mín</th>
                    <th className="py-1 text-right font-medium">Máx</th>
                    <th className="py-1 text-right font-medium">Lluvia</th>
                    <th className="py-1 text-right font-medium">THI</th>
                    <th className="py-1 text-left font-medium">Estrés</th>
                  </tr>
                </thead>
                <tbody>
                  {[...summary.days_series].reverse().map((d) => (
                    <tr key={d.date} className="border-t border-line">
                      <td className="py-1">{d.date}</td>
                      <td className="py-1 text-right tabular-nums">{num(d.tempMinC)}</td>
                      <td className="py-1 text-right tabular-nums">{num(d.tempMaxC)}</td>
                      <td className="py-1 text-right tabular-nums">{num(d.rainMm)}</td>
                      <td className="py-1 text-right tabular-nums">{num(d.thi)}</td>
                      <td className={`py-1 ${NIVEL[d.heat_stress ?? 'none']?.tone ?? ''}`}>
                        {d.heat_stress ? NIVEL[d.heat_stress].label : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <Card>
        <CardTitle>Estaciones</CardTitle>
        <ul className="mt-2 space-y-1 text-body">
          {stations.map((s) => (
            <li key={s.id} className="flex justify-between border-t border-line py-1 first:border-0">
              <span>
                {s.name} <span className="text-ink-3">· {s.serial_number}</span>
              </span>
              <span className="text-ink-3">
                {s.readings} medicion{s.readings === 1 ? '' : 'es'}
                {s.last_seen_at ? ` · última ${new Date(s.last_seen_at).toLocaleDateString('es-AR')}` : ''}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function Kpi({ label, value, unit, hint }: { label: string; value: number | null; unit: string; hint?: string }) {
  return (
    <Card>
      <div className="text-label text-ink-3">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums">
        {value == null ? '—' : `${value} ${unit}`}
      </div>
      {hint && <div className="text-label text-ink-3">{hint}</div>}
    </Card>
  );
}

/** `—` y no `0`: no medir no es medir cero. */
function num(v: number | null): string {
  return v == null ? '—' : String(v);
}
