'use client';

/**
 * Acción de ciclo de vida por animal (A360 E5): descarte / pérdida / transferencia de salida.
 * Escribe con POST /animals/:id/status (regla única AnimalStatusService — valida activo, versiona,
 * timeline, server-origin). Venta y muerte NO están acá (van por Ventas/Mortalidad). Confirma antes.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown } from 'lucide-react';
import { API_URL, authHeaders } from '@/lib/api';
import { Button } from '@/components/Button';

const OPTIONS: { status: string; label: string; verb: string }[] = [
  { status: 'culled', label: 'Descartar', verb: 'descartar' },
  { status: 'lost', label: 'Marcar perdido', verb: 'marcar como perdido' },
  { status: 'transferred', label: 'Transferir (salida)', verb: 'transferir' },
];

export function LifecycleAction({ animalId, active }: { animalId: string; active: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState<(typeof OPTIONS)[number] | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!active) return null;

  async function confirm() {
    if (!pick) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`${API_URL}/animals/${animalId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ status: pick.status, reason: reason || undefined }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.message?.title ?? json?.title ?? `Error ${res.status}`);
      router.refresh();
      setPick(null);
    } catch (e: any) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <div className="relative">
      <Button variant="secondary" size="sm" onClick={() => setOpen((v) => !v)}>
        Baja <ChevronDown size={13} className="ml-1" />
      </Button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-52 rounded-md border border-subtle bg-surface py-1 shadow-[var(--shadow-1)]">
            {OPTIONS.map((o) => (
              <button
                key={o.status}
                onClick={() => { setOpen(false); setPick(o); setReason(''); setError(''); }}
                className="block w-full px-3 py-1.5 text-left text-body text-ink-2 hover:bg-sunken"
              >
                {o.label}
              </button>
            ))}
          </div>
        </>
      )}

      {pick && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" onClick={() => !busy && setPick(null)}>
          <div className="w-full max-w-md rounded-[10px] border border-subtle bg-surface p-6 shadow-[var(--shadow-1)]" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-3 text-subheading font-semibold">{pick.label}</h2>
            <p className="mb-3 text-body text-ink-2">
              Vas a <strong>{pick.verb}</strong> este animal. Sale del stock activo (no recibe más movimientos ni tratamientos).
            </p>
            <label className="block text-label font-medium text-ink-2">Motivo (opcional)</label>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motivo" className="mt-1 h-9 w-full rounded-md border border-strong bg-surface px-2 text-body outline-none focus:ring-2 focus:ring-brand" />
            {error && <p className="mt-3 text-label text-danger">{error}</p>}
            <div className="mt-6 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setPick(null)} disabled={busy}>Cancelar</Button>
              <Button onClick={confirm} loading={busy}>Confirmar</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
