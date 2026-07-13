'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { API_URL, authHeaders } from '@/lib/api';
import { Card, CardTitle } from '@/components/ui';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Plus, Trash2 } from 'lucide-react';

interface Step {
  day: number | string;
  action: string;
}
interface Protocol {
  id: string;
  name: string;
  steps: { day: number; action: string; product_id?: string; notes?: string }[];
  is_active: boolean;
}

export function ProtocolsManager({ initial }: { initial: Protocol[] }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [steps, setSteps] = useState<Step[]>([{ day: 0, action: '' }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const setStep = (i: number, patch: Partial<Step>) => setSteps((s) => s.map((st, j) => (j === i ? { ...st, ...patch } : st)));
  const addStep = () => setSteps((s) => [...s, { day: '', action: '' }]);
  const removeStep = (i: number) => setSteps((s) => (s.length === 1 ? s : s.filter((_, j) => j !== i)));

  async function create() {
    if (busy) return;
    setError('');
    const cleanSteps = steps
      .filter((s) => String(s.action).trim().length > 0)
      .map((s) => ({ day: Number(s.day), action: String(s.action).trim() }));
    if (!name.trim()) {
      setError('El nombre es obligatorio.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`${API_URL}/reproduction/protocols`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ name: name.trim(), steps: cleanSteps }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.title ?? `Error ${res.status}`);
      }
      setName('');
      setSteps([{ day: 0, action: '' }]);
      router.refresh();
    } catch (e: any) {
      setError(e.message ?? 'No se pudo crear el protocolo.');
    } finally {
      setBusy(false);
    }
  }

  async function archive(id: string) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`${API_URL}/reproduction/protocols/${id}`, { method: 'DELETE', headers: authHeaders() });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      router.refresh();
    } catch {
      setError('No se pudo archivar el protocolo.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid grid-cols-5 gap-4 max-lg:grid-cols-1">
      {/* Lista */}
      <Card className="col-span-3">
        <CardTitle action={<span className="text-label text-ink-3">{initial.length} plantillas</span>}>Plantillas</CardTitle>
        {initial.length === 0 ? (
          <p className="py-6 text-center text-body text-ink-3">Sin protocolos todavía. Creá el primero →</p>
        ) : (
          <div className="space-y-2">
            {initial.map((p) => (
              <div key={p.id} className="rounded-md border border-subtle p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-body font-semibold">{p.name}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-label text-ink-3">{p.steps.length} pasos</span>
                    <Button variant="secondary" size="sm" onClick={() => archive(p.id)} disabled={busy}>
                      <Trash2 size={13} /> Archivar
                    </Button>
                  </div>
                </div>
                {p.steps.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {p.steps.map((s, i) => (
                      <span key={i} className="rounded-full bg-sunken px-2 py-0.5 text-label text-ink-2">
                        Día {s.day}: {s.action}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Alta */}
      <Card className="col-span-2 self-start max-lg:col-span-3">
        <CardTitle>Nuevo protocolo</CardTitle>
        {error && (
          <p role="alert" className="mb-2 text-label text-danger">
            {error}
          </p>
        )}
        <label className="mb-3 block">
          <span className="mb-1 block text-caption font-medium text-ink-2">Nombre</span>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="IATF 10 días" />
        </label>
        <span className="mb-1 block text-caption font-medium text-ink-2">Pasos</span>
        <div className="space-y-2">
          {steps.map((s, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
                type="number"
                value={String(s.day)}
                onChange={(e) => setStep(i, { day: e.target.value })}
                aria-label={`Día del paso ${i + 1}`}
                className="w-20"
                fullWidth={false}
              />
              <Input
                value={s.action}
                onChange={(e) => setStep(i, { action: e.target.value })}
                aria-label={`Acción del paso ${i + 1}`}
                placeholder="Acción"
              />
              <button onClick={() => removeStep(i)} aria-label="Quitar paso" className="shrink-0 rounded-md p-1.5 text-ink-3 hover:bg-sunken hover:text-danger">
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
        <button onClick={addStep} className="mt-2 inline-flex items-center gap-1 text-label font-medium text-brand hover:underline">
          <Plus size={14} /> Agregar paso
        </button>
        <div className="mt-4">
          <Button onClick={create} loading={busy} disabled={busy} fullWidth>
            {busy ? 'Creando…' : 'Crear protocolo'}
          </Button>
        </div>
      </Card>
    </div>
  );
}
