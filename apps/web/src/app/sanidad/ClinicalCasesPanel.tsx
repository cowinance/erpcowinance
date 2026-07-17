'use client';

/**
 * Casos clínicos (Sanidad E2): abrir un caso por animal (diagnóstico + severidad),
 * seguirlo (notas y cambios de estado con la máquina de estados del servidor), ver su
 * timeline compuesto (eventos del caso + tratamientos vinculados) y cerrarlo con resultado.
 */
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { API_URL, authHeaders } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { AnimalPicker, PickedAnimal } from '@/components/capture';
import { Activity, ChevronRight, Loader2, Plus } from 'lucide-react';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Select } from '@/components/Select';
import { Field } from '@/components/Field';

const cardCls = 'rounded-[10px] border border-subtle bg-surface p-5 shadow-[var(--shadow-1)]';

const STATUS_ES: Record<string, string> = {
  open: 'Abierto', in_treatment: 'En tratamiento', observation: 'En observación',
  recovered: 'Recuperado', referred: 'Derivado', died: 'Muerto', closed: 'Cerrado',
};
const STATUS_TONE: Record<string, string> = {
  open: 'bg-warning/10 text-warning', in_treatment: 'bg-brand-soft text-brand', observation: 'bg-warning/10 text-warning',
  recovered: 'bg-success/10 text-success', referred: 'bg-sunken text-ink-2', died: 'bg-danger/10 text-danger', closed: 'bg-sunken text-ink-3',
};
const SEV_ES: Record<string, string> = { mild: 'Leve', moderate: 'Moderada', severe: 'Severa' };

function StatusBadge({ status }: { status: string }) {
  return <span className={`shrink-0 rounded px-1.5 py-0.5 text-caption ${STATUS_TONE[status] ?? 'bg-sunken text-ink-3'}`}>{STATUS_ES[status] ?? status}</span>;
}

export function ClinicalCasesPanel({ diagnoses = [], lots = [] }: { diagnoses?: any[]; lots?: any[] }) {
  const router = useRouter();
  const hospLots = lots.filter((l) => (l.purpose === 'hospital' || l.purpose === 'quarantine') && l.is_active !== false);
  const [admitOpen, setAdmitOpen] = useState(false);
  const [cases, setCases] = useState<any[]>([]);
  const [filter, setFilter] = useState('open');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [animal, setAnimal] = useState<PickedAnimal | null>(null);
  const [detail, setDetail] = useState<any | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const c = await fetch(`${API_URL}/clinical-cases?status=${filter}`, { headers: authHeaders() }).then((r) => r.json());
    setCases(Array.isArray(c) ? c : []);
    setLoading(false);
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  async function openDetail(id: string) {
    const d = await fetch(`${API_URL}/clinical-cases/${id}`, { headers: authHeaders() }).then((r) => r.json());
    setDetail(d);
  }

  async function createCase(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!animal) return;
    setBusy(true);
    setMsg('');
    const fd = new FormData(e.currentTarget);
    const res = await fetch(`${API_URL}/clinical-cases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID(), ...authHeaders() },
      body: JSON.stringify({
        animal_id: animal.id,
        diagnosis_id: fd.get('diagnosis_id') || undefined,
        severity: fd.get('severity') || undefined,
        notes: fd.get('notes') || undefined,
      }),
    });
    const j = await res.json().catch(() => null);
    setBusy(false);
    if (res.ok) {
      setCreating(false);
      setAnimal(null);
      setMsg('');
      await load();
      router.refresh();
    } else setMsg(j?.message?.title ?? 'No se pudo abrir el caso');
  }

  async function act(url: string, body: any) {
    setBusy(true);
    setMsg('');
    const res = await fetch(`${API_URL}${url}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(body),
    });
    const j = await res.json().catch(() => null);
    setBusy(false);
    if (res.ok) {
      await openDetail(detail.id);
      await load();
      router.refresh();
    } else setMsg(j?.message?.title ?? 'No se pudo aplicar la acción');
  }

  return (
    <div className={`mt-4 ${cardCls}`}>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-subheading font-semibold">
          <Activity size={16} className="text-brand" /> Casos clínicos
        </h2>
        <div className="flex items-center gap-2">
          <Select value={filter} onChange={(e) => setFilter(e.target.value)} controlSize="sm" fullWidth={false}>
            <option value="open">Abiertos</option>
            <option value="all">Todos</option>
            <option value="closed">Cerrados</option>
          </Select>
          <Button size="sm" onClick={() => setCreating((v) => !v)} className="gap-1.5">
            <Plus size={14} /> Nuevo caso
          </Button>
        </div>
      </div>

      {creating && (
        <form onSubmit={createCase} className="mb-4 space-y-3 rounded-md border border-subtle bg-sunken/40 p-3">
          <div>
            <span className="mb-1 block text-label font-medium text-ink-2">Animal *</span>
            <AnimalPicker animal={animal} onSelect={setAnimal} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Diagnóstico" htmlFor="cc_diag">
              <Select id="cc_diag" name="diagnosis_id" controlSize="md" defaultValue="">
                <option value="">Sin diagnóstico</option>
                {diagnoses.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}{d.is_notifiable ? ' · ⚠' : ''}</option>
                ))}
              </Select>
            </Field>
            <Field label="Severidad" htmlFor="cc_sev">
              <Select id="cc_sev" name="severity" controlSize="md" defaultValue="">
                <option value="">—</option>
                <option value="mild">Leve</option>
                <option value="moderate">Moderada</option>
                <option value="severe">Severa</option>
              </Select>
            </Field>
          </div>
          <Field label="Síntomas / notas" htmlFor="cc_notes">
            <Input id="cc_notes" name="notes" controlSize="md" placeholder="Síntomas observados…" />
          </Field>
          <Button type="submit" size="sm" loading={busy} disabled={!animal}>Abrir caso</Button>
          {msg && <p className="text-label text-danger">{msg}</p>}
        </form>
      )}

      {loading ? (
        <div className="flex justify-center py-6 text-ink-3"><Loader2 size={16} className="animate-spin" /></div>
      ) : cases.length === 0 ? (
        <p className="py-6 text-center text-body text-ink-3">Sin casos {filter === 'open' ? 'abiertos' : ''}.</p>
      ) : (
        <div className="space-y-1">
          {cases.map((c) => (
            <button key={c.id} onClick={() => openDetail(c.id)}
              className={`flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left hover:bg-sunken ${detail?.id === c.id ? 'border-brand' : 'border-subtle'}`}>
              <ChevronRight size={14} className="shrink-0 text-ink-3" />
              <span className="tnum shrink-0 font-medium">{c.tag ?? '—'}</span>
              <span className="min-w-0 flex-1 truncate text-body text-ink-2">
                {c.diagnosis ?? 'Sin diagnóstico'}
                {c.is_notifiable ? <span className="ml-1 text-warning">⚠</span> : null}
                {c.severity ? <span className="text-ink-3"> · {SEV_ES[c.severity]}</span> : null}
                {c.lot_name ? <span className="text-ink-3"> · {c.lot_name}</span> : null}
              </span>
              {c.treatment_count > 0 && <span className="shrink-0 text-caption text-ink-3">{c.treatment_count} trat.</span>}
              <StatusBadge status={c.status} />
            </button>
          ))}
        </div>
      )}

      {detail && (
        <div className="mt-4 rounded-md border border-strong p-4">
          <div className="mb-2 flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="tnum font-semibold">{detail.tag ?? '—'}</span>
                <StatusBadge status={detail.status} />
              </div>
              <p className="mt-0.5 text-label text-ink-3">
                {detail.diagnosis ?? 'Sin diagnóstico'}{detail.diagnosis_category ? ` · ${detail.diagnosis_category}` : ''}
                {detail.is_notifiable ? ' · ⚠ notificable' : ''}
                {detail.severity ? ` · ${SEV_ES[detail.severity]}` : ''} · desde {formatDate(detail.started_at)}
              </p>
            </div>
            <button onClick={() => setDetail(null)} className="text-caption text-ink-3 hover:underline">cerrar</button>
          </div>

          {/* Timeline compuesto */}
          <div className="my-3 space-y-1.5">
            {(detail.timeline ?? []).map((e: any, i: number) => (
              <div key={`t${i}`} className="flex items-start gap-2 text-label">
                <span className="tnum w-20 shrink-0 text-ink-3">{formatDate(e.occurred_at)}</span>
                <span className="text-ink-2">
                  {e.kind === 'opened' ? 'Caso abierto' : e.kind === 'closed' ? 'Caso cerrado' : e.kind === 'status_change' ? `→ ${STATUS_ES[e.status] ?? e.status}` : 'Nota'}
                  {e.note ? <span className="text-ink-3"> · {e.note}</span> : null}
                  {e.actor ? <span className="text-ink-3"> · {e.actor}</span> : null}
                </span>
              </div>
            ))}
            {(detail.treatments ?? []).map((t: any, i: number) => (
              <div key={`tr${i}`} className="flex items-start gap-2 text-label">
                <span className="tnum w-20 shrink-0 text-ink-3">{formatDate(t.applied_at)}</span>
                <span className="text-ink-2">💉 {t.product ?? 'Tratamiento'}{t.dose ? ` · ${t.dose} ml` : ''}{t.meat_withdrawal_until ? ` · retiro hasta ${formatDate(t.meat_withdrawal_until)}` : ''}</span>
              </div>
            ))}
          </div>

          {detail.status !== 'closed' && (
          <>
            <div className="flex flex-wrap items-end gap-2 border-t border-subtle pt-3">
              <label className="flex flex-1 flex-col gap-1">
                <span className="text-compat-10 font-medium text-ink-2">Seguimiento</span>
                <Input id="fu_note" placeholder="Nota de seguimiento…" controlSize="sm" />
              </label>
              <Select id="fu_status" controlSize="sm" fullWidth={false} defaultValue="">
                <option value="">Sin cambio de estado</option>
                {Object.entries(STATUS_ES).filter(([k]) => k !== 'closed' && k !== detail.status).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </Select>
              <Button size="sm" variant="secondary" loading={busy} onClick={() => {
                const note = (document.getElementById('fu_note') as HTMLInputElement)?.value || undefined;
                const status = (document.getElementById('fu_status') as HTMLSelectElement)?.value || undefined;
                if (!note && !status) { setMsg('Escribí una nota o elegí un estado'); return; }
                act(`/clinical-cases/${detail.id}/follow-up`, { note, status });
              }}>Registrar</Button>
              <Select id="cl_outcome" controlSize="sm" fullWidth={false} defaultValue="recovered">
                <option value="recovered">Recuperado</option>
                <option value="referred">Derivado</option>
                <option value="died">Muerto</option>
                <option value="culled">Descartado</option>
                <option value="other">Otro</option>
              </Select>
              <Button size="sm" loading={busy} onClick={() => {
                const outcome = (document.getElementById('cl_outcome') as HTMLSelectElement)?.value;
                act(`/clinical-cases/${detail.id}/close`, { outcome });
              }}>Cerrar caso</Button>
            </div>

            {/* Enviar a hospital / cuarentena (Sanidad E6) */}
            {hospLots.length > 0 && (
              admitOpen ? (
                <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-subtle pt-3">
                  <span className="text-label text-ink-2">Internar en:</span>
                  <Select id="adm_lot" controlSize="sm" fullWidth={false} defaultValue="">
                    <option value="">Elegir lote…</option>
                    {hospLots.map((l) => <option key={l.id} value={l.id}>{l.name} · {l.purpose === 'hospital' ? 'Hospital' : 'Cuarentena'}</option>)}
                  </Select>
                  <Button size="sm" loading={busy} onClick={async () => {
                    const lotId = (document.getElementById('adm_lot') as HTMLSelectElement)?.value;
                    if (!lotId) { setMsg('Elegí un lote'); return; }
                    setBusy(true); setMsg('');
                    const res = await fetch(`${API_URL}/health/admissions`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID(), ...authHeaders() },
                      body: JSON.stringify({ animal_id: detail.animal_id, lot_id: lotId, case_id: detail.id, reason: detail.diagnosis ?? undefined }),
                    });
                    const j = await res.json().catch(() => null);
                    setBusy(false); setAdmitOpen(false);
                    if (res.ok) { await openDetail(detail.id); router.refresh(); }
                    else setMsg(j?.message?.title ?? 'No se pudo internar');
                  }}>Internar</Button>
                  <button onClick={() => setAdmitOpen(false)} className="text-caption text-ink-3 hover:underline">cancelar</button>
                </div>
              ) : (
                <button onClick={() => setAdmitOpen(true)} className="mt-2 text-label text-brand hover:underline">Enviar a hospital / cuarentena →</button>
              )
            )}
          </>
          )}
          {msg && <p className="mt-2 text-label text-danger">{msg}</p>}
        </div>
      )}
    </div>
  );
}
