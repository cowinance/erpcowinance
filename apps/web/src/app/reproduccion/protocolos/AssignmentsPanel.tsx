'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { API_URL, authHeaders } from '@/lib/api';
import { Card, CardTitle } from '@/components/ui';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Select } from '@/components/Select';
import { buildProtocolCalendar, formatCalendarEs, type CalendarProtocol } from '@/lib/protocol-calendar';

interface Protocol {
  id: string;
  name: string;
  is_active: boolean;
  steps: { day: number; action: string }[];
}
interface Lot {
  id: string;
  name: string;
}
interface Assignment {
  id: string;
  protocol_id: string;
  protocol_name: string | null;
  lot_name: string | null;
  start_date: string;
  animal_count: number;
  status: string;
}

/** «Hoy» local en YYYY-MM-DD (día de calendario, sin drift de zona). */
function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function AssignmentsPanel({ protocols, lots, assignments }: { protocols: Protocol[]; lots: Lot[]; assignments: Assignment[] }) {
  const router = useRouter();
  const activeProtocols = protocols.filter((p) => p.is_active);
  const today = localToday();

  const [protocolId, setProtocolId] = useState('');
  const [lotId, setLotId] = useState('');
  const [startDate, setStartDate] = useState(today);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [confirmId, setConfirmId] = useState('');

  const canAssign = activeProtocols.length > 0 && lots.length > 0;
  const activeAssignments = assignments.filter((a) => a.status === 'active');
  const protocolsById = new Map<string, CalendarProtocol>(protocols.map((p) => [p.id, { id: p.id, name: p.name, steps: p.steps ?? [] }]));
  const calendar = buildProtocolCalendar(activeAssignments, protocolsById, today);

  async function assign() {
    if (busy) return;
    setError('');
    setFeedback('');
    if (!protocolId || !lotId || !startDate) {
      setError('Elegí protocolo, lote y fecha.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`${API_URL}/reproduction/protocol-assignments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ protocol_id: protocolId, lot_id: lotId, start_date: startDate }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.title ?? `Error ${res.status}`);
      }
      const j = await res.json();
      const n = j?.tasks_created ?? 0;
      setFeedback(n > 0 ? `Asignación creada — ${n} tarea${n === 1 ? '' : 's'} generada${n === 1 ? '' : 's'}.` : 'La asignación fue creada, pero el protocolo no generó tareas.');
      setProtocolId('');
      setLotId('');
      setStartDate(today);
      router.refresh();
    } catch (e: any) {
      setError(e.message ?? 'No se pudo asignar el protocolo.');
    } finally {
      setBusy(false);
    }
  }

  async function cancel(id: string) {
    if (busy) return;
    setBusy(true);
    setError('');
    setFeedback('');
    try {
      const res = await fetch(`${API_URL}/reproduction/protocol-assignments/${id}/cancel`, { method: 'POST', headers: authHeaders() });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const j = await res.json().catch(() => null);
      setFeedback(`Asignación cancelada — ${j?.canceled_tasks ?? 0} tarea(s) pendiente(s) cancelada(s).`);
      setConfirmId('');
      router.refresh();
    } catch {
      setError('No se pudo cancelar la asignación.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid grid-cols-5 gap-4 max-lg:grid-cols-1">
      {/* Asignar + lista */}
      <Card className="col-span-3">
        <CardTitle>Asignaciones activas</CardTitle>

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

        {/* Formulario de asignación */}
        {!canAssign ? (
          <p className="mb-3 text-label text-ink-3">
            {activeProtocols.length === 0 ? 'Creá una plantilla de protocolo para poder asignar.' : 'No hay lotes disponibles para asignar.'}
          </p>
        ) : (
          <div className="mb-4 flex flex-wrap items-end gap-2">
            <label className="text-label text-ink-3">
              Protocolo
              <Select value={protocolId} onChange={(e) => setProtocolId(e.target.value)} controlSize="sm" fullWidth={false} className="mt-0.5 block" aria-label="Protocolo a asignar">
                <option value="">Elegir…</option>
                {activeProtocols.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </label>
            <label className="text-label text-ink-3">
              Lote
              <Select value={lotId} onChange={(e) => setLotId(e.target.value)} controlSize="sm" fullWidth={false} className="mt-0.5 block" aria-label="Lote destino">
                <option value="">Elegir…</option>
                {lots.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </Select>
            </label>
            <label className="text-label text-ink-3">
              Inicio
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} controlSize="sm" fullWidth={false} className="mt-0.5 block" aria-label="Fecha de inicio" />
            </label>
            <Button size="sm" onClick={assign} loading={busy} disabled={busy}>
              Asignar protocolo
            </Button>
          </div>
        )}

        {/* Lista de asignaciones activas */}
        {activeAssignments.length === 0 ? (
          <p className="py-4 text-center text-label text-ink-3">Sin asignaciones activas.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-body">
              <thead>
                <tr className="h-8 border-b border-subtle text-left text-caption font-medium tracking-[0.06em] text-ink-3 uppercase">
                  <th>Protocolo</th>
                  <th>Lote</th>
                  <th>Inicio</th>
                  <th className="text-right">Vientres</th>
                  <th className="pr-1 text-right">Acción</th>
                </tr>
              </thead>
              <tbody>
                {activeAssignments.map((a) => (
                  <tr key={a.id} className="h-9 border-b border-subtle last:border-0">
                    <td className="font-medium">{a.protocol_name ?? 'Protocolo no disponible'}</td>
                    <td className="text-ink-2">{a.lot_name ?? '—'}</td>
                    <td className="text-ink-2">{formatCalendarEs(String(a.start_date).slice(0, 10))}</td>
                    <td className="tnum text-right">{a.animal_count}</td>
                    <td className="pr-1 text-right">
                      {confirmId === a.id ? (
                        <span className="inline-flex items-center gap-1">
                          <Button
                            size="sm"
                            onClick={() => cancel(a.id)}
                            loading={busy}
                            disabled={busy}
                            aria-label={`Confirmar cancelación de ${a.protocol_name ?? 'protocolo'} en ${a.lot_name ?? 'lote'}`}
                          >
                            Confirmar
                          </Button>
                          <button onClick={() => setConfirmId('')} className="text-label text-ink-3 hover:underline">
                            No
                          </button>
                        </span>
                      ) : (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setConfirmId(a.id)}
                          disabled={busy}
                          aria-label={`Cancelar asignación de ${a.protocol_name ?? 'protocolo'} al lote ${a.lot_name ?? 'lote'}`}
                        >
                          Cancelar
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-caption text-ink-3">Cancelar deja de mostrar la asignación como activa y cancela sus tareas pendientes.</p>
          </div>
        )}
      </Card>

      {/* Calendario previsto */}
      <Card className="col-span-2 self-start max-lg:col-span-3">
        <CardTitle action={<span className="text-label text-ink-3">desde hoy</span>}>Próximos pasos programados</CardTitle>
        <p className="mb-2 text-caption text-ink-3">Proyección de las plantillas actuales; no es un historial ni la lista de tareas (ver Tareas/Agenda).</p>
        {calendar.length === 0 ? (
          <p className="py-4 text-center text-label text-ink-3">Sin próximos pasos programados.</p>
        ) : (
          <ul className="space-y-1.5">
            {calendar.map((it, i) => (
              <li key={`${it.assignment_id}-${i}`} className="flex items-baseline gap-2 text-body">
                <time dateTime={it.date} className="tnum w-24 shrink-0 text-label text-ink-3">
                  {formatCalendarEs(it.date)}
                </time>
                <span className="flex-1">
                  <span className="font-medium">{it.action}</span> <span className="text-label text-ink-3">· {it.lot}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
