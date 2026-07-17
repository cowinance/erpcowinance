'use client';

/**
 * Hospital y cuarentena (Sanidad E6): internaciones abiertas (animal, tipo, lote, días, alta estimada),
 * ingreso de un animal a un lote hospital/cuarentena y alta sanitaria (vuelve a su lote anterior o a
 * uno destino). El movimiento lo hace el backend con la regla única; acá solo la UI de control.
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { API_URL, authHeaders } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { AnimalPicker, PickedAnimal } from '@/components/capture';
import { HeartPulse, Loader2, Plus } from 'lucide-react';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Select } from '@/components/Select';
import { Field } from '@/components/Field';

const cardCls = 'rounded-[10px] border border-subtle bg-surface p-5 shadow-[var(--shadow-1)]';
const KIND_ES: Record<string, string> = { hospital: 'Hospital', quarantine: 'Cuarentena' };

export function HospitalPanel({ lots = [] }: { lots?: any[] }) {
  const router = useRouter();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [admitting, setAdmitting] = useState(false);
  const [animal, setAnimal] = useState<PickedAnimal | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [dischargeFor, setDischargeFor] = useState<string | null>(null);

  const hospLots = lots.filter((l) => (l.purpose === 'hospital' || l.purpose === 'quarantine') && l.is_active !== false);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetch(`${API_URL}/health/admissions?status=admitted`, { headers: authHeaders() }).then((x) => x.json()).catch(() => []);
    setRows(Array.isArray(r) ? r : []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function admit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!animal) return;
    setBusy(true);
    setMsg('');
    const fd = new FormData(e.currentTarget);
    const res = await fetch(`${API_URL}/health/admissions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID(), ...authHeaders() },
      body: JSON.stringify({
        animal_id: animal.id,
        lot_id: fd.get('lot_id'),
        reason: fd.get('reason') || undefined,
        expected_discharge_at: fd.get('expected_discharge_at') || undefined,
        health_status: fd.get('health_status') || undefined,
      }),
    });
    const j = await res.json().catch(() => null);
    setBusy(false);
    if (res.ok) {
      setAdmitting(false);
      setAnimal(null);
      await load();
      router.refresh();
    } else setMsg(j?.message?.title ?? 'No se pudo internar');
  }

  async function discharge(id: string, destLotId?: string) {
    setBusy(true);
    const res = await fetch(`${API_URL}/health/admissions/${id}/discharge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(destLotId ? { discharge_lot_id: destLotId } : {}),
    });
    setBusy(false);
    setDischargeFor(null);
    if (res.ok) {
      await load();
      router.refresh();
    }
  }

  return (
    <div className={`mt-4 ${cardCls}`}>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-subheading font-semibold">
          <HeartPulse size={16} className="text-brand" /> Hospital y cuarentena
        </h2>
        <div className="flex items-center gap-2">
          <span className="text-label text-ink-3">{rows.length} internados</span>
          <Button size="sm" onClick={() => setAdmitting((v) => !v)} className="gap-1.5" disabled={hospLots.length === 0}>
            <Plus size={14} /> Ingresar animal
          </Button>
        </div>
      </div>

      {hospLots.length === 0 && (
        <p className="mb-3 text-label text-ink-3">Creá un lote con propósito «hospital» o «cuarentena» para internar animales.</p>
      )}

      {admitting && hospLots.length > 0 && (
        <form onSubmit={admit} className="mb-4 space-y-3 rounded-md border border-subtle bg-sunken/40 p-3">
          <div>
            <span className="mb-1 block text-label font-medium text-ink-2">Animal *</span>
            <AnimalPicker animal={animal} onSelect={setAnimal} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Lote destino *" htmlFor="lot_id">
              <Select id="lot_id" name="lot_id" required controlSize="md" defaultValue="">
                <option value="">Elegir…</option>
                {hospLots.map((l) => (
                  <option key={l.id} value={l.id}>{l.name} · {KIND_ES[l.purpose]}</option>
                ))}
              </Select>
            </Field>
            <Field label="Alta estimada" htmlFor="expected_discharge_at">
              <Input id="expected_discharge_at" name="expected_discharge_at" type="date" controlSize="md" />
            </Field>
          </div>
          <Field label="Motivo de ingreso" htmlFor="reason">
            <Input id="reason" name="reason" controlSize="md" placeholder="Diagnóstico / motivo…" />
          </Field>
          <Field label="Estado sanitario" htmlFor="health_status">
            <Input id="health_status" name="health_status" controlSize="md" placeholder="Ej: estable, en tratamiento…" />
          </Field>
          <Button type="submit" size="sm" loading={busy} disabled={!animal}>Internar</Button>
          {msg && <p className="text-label text-danger">{msg}</p>}
        </form>
      )}

      {loading ? (
        <div className="flex justify-center py-6 text-ink-3"><Loader2 size={16} className="animate-spin" /></div>
      ) : rows.length === 0 ? (
        <p className="py-6 text-center text-body text-ink-3">Sin animales internados.</p>
      ) : (
        <div className="space-y-1">
          {rows.map((r) => (
            <div key={r.id} className="rounded-md border border-subtle px-3 py-2">
              <div className="flex items-center gap-2">
                <Link href={`/animales/${r.animal_id}`} className="tnum shrink-0 font-medium text-brand hover:underline">{r.tag ?? '—'}</Link>
                <span className="rounded bg-brand-soft px-1.5 py-0.5 text-caption text-brand">{KIND_ES[r.kind]}</span>
                <span className="min-w-0 flex-1 truncate text-label text-ink-3">
                  {r.lot_name}{r.reason ? ` · ${r.reason}` : ''}{r.health_status ? ` · ${r.health_status}` : ''}
                </span>
                <span className={`shrink-0 text-caption ${r.overdue ? 'text-danger' : 'text-ink-3'}`}>
                  {r.days_admitted} d{r.expected_discharge_at ? ` · alta ${formatDate(r.expected_discharge_at)}${r.overdue ? ' ⚠' : ''}` : ''}
                </span>
                {dischargeFor === r.id ? null : (
                  <Button size="sm" variant="secondary" onClick={() => setDischargeFor(r.id)}>Dar de alta</Button>
                )}
              </div>
              {dischargeFor === r.id && (
                <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-subtle pt-2">
                  <span className="text-label text-ink-2">Destino:</span>
                  <Button size="sm" loading={busy} onClick={() => discharge(r.id)} disabled={!r.from_lot_id}>
                    Volver a {r.from_lot_name ?? 'lote anterior'}
                  </Button>
                  <Select id={`dest-${r.id}`} controlSize="sm" fullWidth={false} defaultValue="">
                    <option value="">Otro lote…</option>
                    {lots.filter((l) => l.id !== r.lot_id && l.is_active !== false).map((l) => (
                      <option key={l.id} value={l.id}>{l.name}</option>
                    ))}
                  </Select>
                  <Button size="sm" variant="secondary" loading={busy} onClick={() => {
                    const dest = (document.getElementById(`dest-${r.id}`) as HTMLSelectElement)?.value;
                    if (dest) discharge(r.id, dest);
                  }}>Mover ahí</Button>
                  <button onClick={() => setDischargeFor(null)} className="text-caption text-ink-3 hover:underline">cancelar</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
