'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { API_URL, authHeaders } from '@/lib/api';
import { Card, CardTitle } from '@/components/ui';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { farmToday } from '@/lib/date';

interface Estado {
  level_cm: number | null;
  last_reading_date: string | null;
  last_refill_date: string | null;
  daily_cm: number | null;
  days_remaining: number | null;
  projected_empty_date: string | null;
  status: 'ok' | 'warning' | 'critical' | 'unknown';
  reason: string | null;
}
interface Nitrogeno {
  tank_id: string;
  tank_code: string | null;
  lead_days: number;
  state: Estado;
  message: string | null;
  readings: { id: string; reading_date: string; level_cm: number; notes: string | null }[];
  refills: { id: string; refill_date: string; liters: number; level_after_cm: number | null }[];
}

const TONO: Record<Estado['status'], string> = {
  ok: 'text-success',
  warning: 'text-warning',
  critical: 'text-danger',
  unknown: 'text-ink-3',
};
const ETIQUETA: Record<Estado['status'], string> = {
  ok: 'Con margen',
  warning: 'Pedir la recarga',
  critical: 'Urgente',
  unknown: 'Sin datos suficientes',
};

/**
 * Nitrógeno del termo (GT-4).
 *
 * El número grande es **días restantes**, no el nivel. Un termo al 20 % puede estar tranquilo si
 * consume poco, y uno al 50 % puede ser urgencia si evapora rápido: lo que decide es si todavía se
 * llega a pedir. Poner los centímetros al frente invitaría a mirar el dato equivocado.
 */
export function NitrogenPanel({ data }: { data: Nitrogeno }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [nivel, setNivel] = useState('');
  const [fecha, setFecha] = useState(farmToday());
  const [litros, setLitros] = useState('');
  const [nivelPost, setNivelPost] = useState('');
  const [lead, setLead] = useState(String(data.lead_days));

  const { state } = data;

  async function call(method: string, path: string, body?: any, onOk?: () => void) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`${API_URL}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.title ?? `Error ${res.status}`);
      }
      onOk?.();
      router.refresh();
    } catch (e: any) {
      setError(e.message ?? 'No se pudo guardar.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardTitle>
        <span>Nitrógeno</span>
        <span className={`text-caption font-medium ${TONO[state.status]}`}>{ETIQUETA[state.status]}</span>
      </CardTitle>

      {error && (
        <p role="alert" className="mb-2 text-label text-danger">
          {error}
        </p>
      )}

      <div className="grid grid-cols-4 gap-3 max-md:grid-cols-2">
        <div>
          <div className="text-caption text-ink-3">Días que quedan</div>
          <div className={`tnum text-2xl font-semibold ${TONO[state.status]}`}>
            {state.days_remaining ?? '—'}
          </div>
        </div>
        <div>
          <div className="text-caption text-ink-3">Vacío estimado</div>
          <div className="tnum text-body font-medium">{state.projected_empty_date ?? '—'}</div>
        </div>
        <div>
          <div className="text-caption text-ink-3">Nivel</div>
          <div className="tnum text-body font-medium">{state.level_cm !== null ? `${state.level_cm} cm` : '—'}</div>
        </div>
        <div>
          <div className="text-caption text-ink-3">Consumo</div>
          <div className="tnum text-body font-medium">{state.daily_cm !== null ? `${state.daily_cm} cm/día` : '—'}</div>
        </div>
      </div>

      {/* Cuando no se puede proyectar, se dice POR QUÉ. Un panel en blanco se lee como «está todo
          bien», que es justo lo que no se sabe. */}
      {state.reason && <p className="mt-3 rounded-md bg-sunken px-3 py-2 text-label text-ink-2">{state.reason}</p>}
      {data.message && (
        <p role="alert" className={`mt-3 rounded-md px-3 py-2 text-label ${state.status === 'critical' ? 'bg-danger/10 text-danger' : 'bg-warning/10 text-warning'}`}>
          {data.message}
        </p>
      )}

      <div className="mt-4 grid grid-cols-2 gap-4 max-md:grid-cols-1">
        <div className="rounded-md border border-subtle p-3">
          <div className="mb-2 text-label font-medium">Medir el nivel</div>
          <div className="flex flex-wrap items-center gap-2">
            <Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} controlSize="sm" aria-label="Fecha de la medición" className="w-40" />
            <Input value={nivel} onChange={(e) => setNivel(e.target.value)} inputMode="decimal" placeholder="cm" aria-label="Nivel en centímetros" controlSize="sm" className="w-24" />
            <Button
              size="sm"
              loading={busy}
              disabled={!nivel.trim()}
              onClick={() => call('POST', `/genetics/cryo/tanks/${data.tank_id}/nitrogen/readings`, { reading_date: fecha, level_cm: nivel }, () => setNivel(''))}
            >
              Guardar
            </Button>
          </div>
          {data.readings.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-caption text-ink-3">
              {data.readings.slice(0, 6).map((r) => (
                <li key={r.id}>
                  {r.reading_date}: <span className="tnum">{r.level_cm} cm</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-md border border-subtle p-3">
          <div className="mb-2 text-label font-medium">Registrar recarga</div>
          <div className="flex flex-wrap items-center gap-2">
            <Input value={litros} onChange={(e) => setLitros(e.target.value)} inputMode="decimal" placeholder="litros" aria-label="Litros cargados" controlSize="sm" className="w-24" />
            <Input value={nivelPost} onChange={(e) => setNivelPost(e.target.value)} inputMode="decimal" placeholder="nivel después (cm)" aria-label="Nivel después de la recarga" controlSize="sm" className="w-40" />
            <Button
              size="sm"
              loading={busy}
              disabled={!litros.trim()}
              onClick={() =>
                call(
                  'POST',
                  `/genetics/cryo/tanks/${data.tank_id}/nitrogen/refills`,
                  { refill_date: farmToday(), liters: litros, level_after_cm: nivelPost },
                  () => {
                    setLitros('');
                    setNivelPost('');
                  },
                )
              }
            >
              Cargar
            </Button>
          </div>
          {/* El consumo solo se puede medir entre recargas: sin el nivel post-recarga hay que
              esperar a la próxima medición para volver a proyectar. */}
          <p className="mt-2 text-caption text-ink-3">
            Anotar el nivel de después arranca el ciclo nuevo enseguida; sin eso hay que esperar a la próxima medición.
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-subtle pt-3">
        <span className="text-caption text-ink-3">El proveedor tarda</span>
        <Input value={lead} onChange={(e) => setLead(e.target.value)} inputMode="numeric" aria-label="Días que tarda el proveedor" controlSize="sm" className="w-20" />
        <span className="text-caption text-ink-3">días — es lo que decide si esto es un aviso o una urgencia.</span>
        <Button
          size="sm"
          variant="secondary"
          loading={busy}
          disabled={lead === String(data.lead_days)}
          onClick={() => call('PUT', `/genetics/cryo/tanks/${data.tank_id}/nitrogen/lead-days`, { refill_lead_days: lead })}
        >
          Guardar
        </Button>
      </div>
    </Card>
  );
}
