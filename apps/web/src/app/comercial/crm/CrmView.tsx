'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { API_URL, authHeaders } from '@/lib/api';
import { Card, CardTitle } from '@/components/ui';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Select } from '@/components/Select';
import { Field } from '@/components/Field';

interface Partner {
  id: string;
  name: string;
  type: string;
}
interface Opportunity {
  id: string;
  partner_id: string;
  partner_name: string;
  title: string;
  stage: string;
  expected_value: number | null;
  expected_close_date: string | null;
  lost_reason: string | null;
}
interface Contract {
  id: string;
  partner_name: string;
  type: string;
  start_date: string;
  end_date: string | null;
  value: number | null;
  standing: string;
}
interface FollowUp {
  id: string;
  partner_name: string;
  next_action: string;
  next_action_at: string;
}
interface Interaction {
  id: string;
  partner_name: string;
  kind: string;
  occurred_at: string;
  summary: string;
  actor: string | null;
}
interface Summary {
  activeCustomers: number;
  pendingFollowUps: number;
  pipeline: {
    open: number;
    won: number;
    lost: number;
    openValue: number | null;
    weightedValue: number | null;
    openWithoutValue: number;
    winRate: number | null;
    byStage: Record<string, { count: number; value: number | null }>;
  };
  contracts: { active: number; expiringSoon: number; expired: number; currentValue: number | null; currentWithoutValue: number };
}

/** Etapas ABIERTAS, en orden del embudo. Las cerradas se muestran aparte. */
const ETAPAS = [
  { key: 'lead', label: 'Contacto inicial' },
  { key: 'qualified', label: 'Calificada' },
  { key: 'proposal', label: 'Propuesta' },
  { key: 'negotiation', label: 'Negociación' },
] as const;

const STANDING: Record<string, { label: string; tone: string }> = {
  draft: { label: 'Borrador', tone: 'text-ink-3' },
  upcoming: { label: 'Por comenzar', tone: 'text-ink-3' },
  active: { label: 'Vigente', tone: 'text-ink-2' },
  expiring_soon: { label: 'Por vencer', tone: 'text-warning' },
  expired: { label: 'Vencido', tone: 'text-danger' },
  terminated: { label: 'Rescindido', tone: 'text-ink-3' },
};

/** Los tipos de contrato del modelo canónico, en el idioma del producto. */
const CONTRACT_TYPE: Record<string, string> = {
  supply: 'Suministro',
  lease: 'Arrendamiento',
  capitalization: 'Capitalización',
  agistment: 'Pastaje',
  service: 'Servicios',
  other: 'Otro',
};

const KIND: Record<string, string> = {
  call: 'Llamada',
  visit: 'Visita',
  email: 'Email',
  whatsapp: 'WhatsApp',
  meeting: 'Reunión',
  note: 'Nota',
};

export function CrmView({
  summary,
  opportunities,
  partners,
  contracts,
  followUps,
  interactions,
}: {
  summary: Summary;
  opportunities: Opportunity[];
  partners: Partner[];
  contracts: Contract[];
  followUps: FollowUp[];
  interactions: Interaction[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [nueva, setNueva] = useState({ partner_id: partners[0]?.id ?? '', title: '', expected_value: '', expected_close_date: '' });
  const [charla, setCharla] = useState({ partner_id: partners[0]?.id ?? '', kind: 'call', summary: '', next_action: '', next_action_at: '' });

  async function call(method: string, path: string, data?: unknown): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`${API_URL}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: data ? JSON.stringify(data) : undefined,
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

  async function mover(o: Opportunity, stage: string) {
    // Perder pide motivo: el backend lo exige y sin preguntarlo el usuario vería un error seco.
    const lost_reason = stage === 'lost' ? window.prompt('¿Por qué se perdió?')?.trim() : undefined;
    if (stage === 'lost' && !lost_reason) return;
    await call('PATCH', `/crm/opportunities/${o.id}/stage`, { stage, lost_reason });
  }

  const abiertas = opportunities.filter((o) => !['won', 'lost'].includes(o.stage));
  const cerradas = opportunities.filter((o) => ['won', 'lost'].includes(o.stage));

  return (
    <div className="space-y-4">
      {error && <p role="alert" className="text-label text-danger">{error}</p>}

      {/* Los cuatro indicadores del catálogo. */}
      <div className="grid grid-cols-4 gap-4 max-lg:grid-cols-2">
        <Kpi label="Clientes activos" value={summary.activeCustomers} />
        <Kpi label="Oportunidades abiertas" value={summary.pipeline.open} hint={pipelineHint(summary)} />
        <Kpi label="Contratos por vencer" value={summary.contracts.expiringSoon} tone={summary.contracts.expiringSoon > 0 ? 'text-warning' : ''} />
        <Kpi
          label="Valor de cartera"
          value={summary.contracts.currentValue}
          money
          hint={summary.contracts.currentWithoutValue > 0 ? `${summary.contracts.currentWithoutValue} sin valor cargado` : undefined}
        />
      </div>

      {/* Embudo. Muestra el nominal Y el ponderado: el ponderado solo es un peso, no una predicción. */}
      <Card>
        <CardTitle>Embudo</CardTitle>
        <div className="mt-2 grid grid-cols-4 gap-3 max-lg:grid-cols-2">
          {ETAPAS.map((e) => {
            const s = summary.pipeline.byStage[e.key] ?? { count: 0, value: null };
            return (
              <div key={e.key} className="rounded-md border border-line p-2">
                <div className="text-label text-ink-3">{e.label}</div>
                <div className="text-lg font-semibold tabular-nums">{s.count}</div>
                <div className="text-label text-ink-3">{s.value == null ? '—' : money(s.value)}</div>
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-label text-ink-3">
          En curso: {summary.pipeline.openValue == null ? '—' : money(summary.pipeline.openValue)} nominal ·{' '}
          {summary.pipeline.weightedValue == null ? '—' : money(summary.pipeline.weightedValue)} ponderado por etapa
          {summary.pipeline.winRate != null && ` · conversión ${summary.pipeline.winRate}%`}
          {summary.pipeline.openWithoutValue > 0 && ` · ${summary.pipeline.openWithoutValue} sin valor cargado`}
        </p>
      </Card>

      <div className="grid grid-cols-3 gap-4 max-lg:grid-cols-1">
        <Card className="self-start">
          <CardTitle>Nueva oportunidad</CardTitle>
          <div className="mt-2 space-y-2">
            <Field label="Socio" htmlFor="op-socio">
              <Select id="op-socio" value={nueva.partner_id} onChange={(e) => setNueva({ ...nueva, partner_id: e.target.value })}>
                {partners.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Título" htmlFor="op-titulo">
              <Input id="op-titulo" value={nueva.title} onChange={(e) => setNueva({ ...nueva, title: e.target.value })} />
            </Field>
            <Field label="Valor estimado" htmlFor="op-valor" help="Opcional: si todavía no se sabe, dejalo vacío.">
              <Input id="op-valor" type="number" value={nueva.expected_value} onChange={(e) => setNueva({ ...nueva, expected_value: e.target.value })} />
            </Field>
            <Field label="Cierre esperado" htmlFor="op-fecha">
              <Input id="op-fecha" type="date" value={nueva.expected_close_date} onChange={(e) => setNueva({ ...nueva, expected_close_date: e.target.value })} />
            </Field>
            <Button
              disabled={busy || !nueva.title.trim() || !nueva.partner_id}
              onClick={async () => {
                if (await call('POST', '/crm/opportunities', { ...nueva, expected_value: nueva.expected_value || undefined, expected_close_date: nueva.expected_close_date || undefined }))
                  setNueva({ ...nueva, title: '', expected_value: '', expected_close_date: '' });
              }}
            >
              Crear
            </Button>
          </div>
        </Card>

        <Card className="col-span-2 max-lg:col-span-1">
          <CardTitle>Oportunidades en curso</CardTitle>
          {abiertas.length === 0 ? (
            <p className="mt-2 text-label text-ink-3">No hay oportunidades abiertas.</p>
          ) : (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-body">
                <thead>
                  <tr className="text-label text-ink-3">
                    <th className="py-1 text-left font-medium">Oportunidad</th>
                    <th className="py-1 text-left font-medium">Socio</th>
                    <th className="py-1 text-right font-medium">Valor</th>
                    <th className="py-1 text-left font-medium">Etapa</th>
                    <th className="py-1 text-left font-medium">Mover a</th>
                  </tr>
                </thead>
                <tbody>
                  {abiertas.map((o) => (
                    <tr key={o.id} className="border-t border-line">
                      <td className="py-1">{o.title}</td>
                      <td className="py-1 text-ink-2">{o.partner_name}</td>
                      <td className="py-1 text-right tabular-nums">{o.expected_value == null ? '—' : money(o.expected_value)}</td>
                      <td className="py-1">{ETAPAS.find((e) => e.key === o.stage)?.label ?? o.stage}</td>
                      <td className="py-1">
                        <Select
                          value=""
                          onChange={(e) => e.target.value && mover(o, e.target.value)}
                          controlSize="sm"
                          fullWidth={false}
                          aria-label={`Mover ${o.title}`}
                          disabled={busy}
                        >
                          <option value="">Elegir…</option>
                          {ETAPAS.filter((e) => e.key !== o.stage).map((e) => (
                            <option key={e.key} value={e.key}>
                              {e.label}
                            </option>
                          ))}
                          <option value="won">Ganada</option>
                          <option value="lost">Perdida</option>
                        </Select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {cerradas.length > 0 && (
            <p className="mt-2 text-label text-ink-3">
              Cerradas: {summary.pipeline.won} ganada{summary.pipeline.won === 1 ? '' : 's'} · {summary.pipeline.lost} perdida
              {summary.pipeline.lost === 1 ? '' : 's'}
            </p>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-3 gap-4 max-lg:grid-cols-1">
        <Card className="self-start">
          <CardTitle>Registrar contacto</CardTitle>
          <div className="mt-2 space-y-2">
            <Field label="Socio" htmlFor="in-socio">
              <Select id="in-socio" value={charla.partner_id} onChange={(e) => setCharla({ ...charla, partner_id: e.target.value })}>
                {partners.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Tipo" htmlFor="in-tipo">
              <Select id="in-tipo" value={charla.kind} onChange={(e) => setCharla({ ...charla, kind: e.target.value })}>
                {Object.entries(KIND).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Qué se habló" htmlFor="in-resumen">
              <Input id="in-resumen" value={charla.summary} onChange={(e) => setCharla({ ...charla, summary: e.target.value })} />
            </Field>
            <Field label="Próxima acción" htmlFor="in-accion">
              <Input id="in-accion" value={charla.next_action} onChange={(e) => setCharla({ ...charla, next_action: e.target.value })} />
            </Field>
            <Field label="Para cuándo" htmlFor="in-fecha">
              <Input id="in-fecha" type="date" value={charla.next_action_at} onChange={(e) => setCharla({ ...charla, next_action_at: e.target.value })} />
            </Field>
            <Button
              disabled={busy || !charla.summary.trim()}
              onClick={async () => {
                if (
                  await call('POST', '/crm/interactions', {
                    ...charla,
                    next_action: charla.next_action || undefined,
                    next_action_at: charla.next_action_at || undefined,
                  })
                )
                  setCharla({ ...charla, summary: '', next_action: '', next_action_at: '' });
              }}
            >
              Registrar
            </Button>
          </div>
        </Card>

        <Card>
          <CardTitle>Seguimientos pendientes</CardTitle>
          {followUps.length === 0 ? (
            <p className="mt-2 text-label text-ink-3">Nada agendado para los próximos días.</p>
          ) : (
            <ul className="mt-2 space-y-1 text-body">
              {followUps.map((f) => (
                <li key={f.id} className="border-t border-line py-1 first:border-0">
                  <div className="font-medium">{f.next_action}</div>
                  <div className="text-label text-ink-3">
                    {f.partner_name} · {f.next_action_at}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardTitle>Últimas interacciones</CardTitle>
          {interactions.length === 0 ? (
            <p className="mt-2 text-label text-ink-3">Todavía no se registró ninguna.</p>
          ) : (
            <ul className="mt-2 space-y-1 text-body">
              {interactions.map((i) => (
                <li key={i.id} className="border-t border-line py-1 first:border-0">
                  <div>{i.summary}</div>
                  <div className="text-label text-ink-3">
                    {KIND[i.kind] ?? i.kind} · {i.partner_name} · {new Date(i.occurred_at).toLocaleDateString('es-AR')}
                    {i.actor ? ` · ${i.actor}` : ''}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card>
        <CardTitle>Contratos</CardTitle>
        {contracts.length === 0 ? (
          <p className="mt-2 text-label text-ink-3">No hay contratos cargados.</p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-body">
              <thead>
                <tr className="text-label text-ink-3">
                  <th className="py-1 text-left font-medium">Socio</th>
                  <th className="py-1 text-left font-medium">Tipo</th>
                  <th className="py-1 text-left font-medium">Desde</th>
                  <th className="py-1 text-left font-medium">Hasta</th>
                  <th className="py-1 text-right font-medium">Valor</th>
                  <th className="py-1 text-left font-medium">Situación</th>
                </tr>
              </thead>
              <tbody>
                {contracts.map((c) => (
                  <tr key={c.id} className="border-t border-line">
                    <td className="py-1">{c.partner_name}</td>
                    <td className="py-1 text-ink-2">{CONTRACT_TYPE[c.type] ?? c.type}</td>
                    <td className="py-1 tabular-nums">{c.start_date}</td>
                    <td className="py-1 tabular-nums">{c.end_date ?? 'Sin vencimiento'}</td>
                    <td className="py-1 text-right tabular-nums">{c.value == null ? '—' : money(c.value)}</td>
                    <td className={`py-1 ${STANDING[c.standing]?.tone ?? ''}`}>{STANDING[c.standing]?.label ?? c.standing}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function pipelineHint(s: Summary): string | undefined {
  if (s.pipeline.openValue == null) return undefined;
  return `${money(s.pipeline.weightedValue ?? 0)} ponderado`;
}

function Kpi({ label, value, hint, money: isMoney, tone }: { label: string; value: number | null; hint?: string; money?: boolean; tone?: string }) {
  return (
    <Card>
      <div className="text-label text-ink-3">{label}</div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${tone ?? ''}`}>
        {value == null ? '—' : isMoney ? money(value) : value}
      </div>
      {hint && <div className="text-label text-ink-3">{hint}</div>}
    </Card>
  );
}

function money(n: number): string {
  return n.toLocaleString('es-AR', { maximumFractionDigits: 0 });
}
