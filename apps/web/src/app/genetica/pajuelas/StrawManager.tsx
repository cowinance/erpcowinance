'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { STRAW_EXIT_REASONS, cryoLocationLabel } from '@cowinance/domain';
import { API_URL, authHeaders } from '@/lib/api';
import { Card, CardTitle } from '@/components/ui';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Select } from '@/components/Select';

interface Straw {
  id: string;
  code: string | null;
  status: 'stored' | 'used' | 'lost' | 'discarded' | 'sold';
  status_reason: string | null;
  goblet_id: string | null;
  tank_code: string | null;
  canister_code: string | null;
  canister_color: string | null;
  goblet_code: string | null;
}
interface GobletOption {
  id: string;
  label: string;
}

const ESTADO_ES: Record<Straw['status'], string> = {
  stored: 'En el termo',
  used: 'Usada',
  lost: 'Perdida',
  discarded: 'Descartada',
  sold: 'Vendida',
};

/**
 * Inventario físico de una partida (GT-2).
 *
 * La operación central es **ubicar**: se seleccionan varias y se mandan a un gobelete. Se trabaja
 * de a muchas y no de a una porque así es como se hace frente al termo — se saca un gobelete
 * entero, se cuenta lo que hay y se registra de una sola vez, con la tapa abierta el menor tiempo
 * posible.
 */
export function StrawManager({
  title,
  straws,
  goblets,
  ownerParam,
}: {
  title: string;
  straws: Straw[];
  goblets: GobletOption[];
  ownerParam: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [destino, setDestino] = useState('');

  const disponibles = straws.filter((s) => s.status === 'stored');
  const sinUbicar = disponibles.filter((s) => s.goblet_id === null);

  async function call(method: string, path: string, data?: any, onOk?: () => void) {
    if (busy) return;
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
      onOk?.();
      router.refresh();
    } catch (e: any) {
      setError(e.message ?? 'No se pudo guardar.');
    } finally {
      setBusy(false);
    }
  }

  const toggle = (id: string) =>
    setSel((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>
          <span>{title}</span>
          <span className="text-caption font-normal text-ink-3">
            {disponibles.length} en el termo · {sinUbicar.length} sin ubicar
          </span>
        </CardTitle>

        {error && (
          <p role="alert" className="mb-2 text-label text-danger">
            {error}
          </p>
        )}

        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md bg-sunken px-3 py-2">
          <button
            onClick={() => setSel(new Set(sinUbicar.map((s) => s.id)))}
            disabled={sinUbicar.length === 0}
            className="h-8 rounded-md border border-strong bg-surface px-2.5 text-label disabled:opacity-40"
          >
            Elegir las {sinUbicar.length} sin ubicar
          </button>
          <button
            onClick={() => setSel(new Set())}
            disabled={sel.size === 0}
            className="h-8 rounded-md border border-strong bg-surface px-2.5 text-label disabled:opacity-40"
          >
            Limpiar
          </button>
          <Select value={destino} onChange={(e) => setDestino(e.target.value)} controlSize="sm" aria-label="Gobelete destino" className="w-64">
            <option value="">Elegí el gobelete…</option>
            {goblets.map((g) => (
              <option key={g.id} value={g.id}>
                {g.label}
              </option>
            ))}
          </Select>
          <Button
            size="sm"
            loading={busy}
            disabled={sel.size === 0 || !destino}
            onClick={() => call('POST', '/genetics/straws/move', { ids: [...sel], goblet_id: destino }, () => setSel(new Set()))}
          >
            Ubicar {sel.size > 0 ? `(${sel.size})` : ''}
          </Button>
        </div>

        {straws.length === 0 ? (
          <p className="text-body text-ink-3">Esta partida todavía no tiene pajuelas cargadas.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-body">
              <thead className="text-left text-caption text-ink-3">
                <tr className="border-b border-subtle">
                  <th className="w-8 py-1.5"> </th>
                  <th className="py-1.5">Ubicación</th>
                  <th className="py-1.5">Código impreso</th>
                  <th className="py-1.5">Estado</th>
                  <th className="py-1.5 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-subtle">
                {straws.map((s) => (
                  <tr key={s.id}>
                    <td className="py-1.5">
                      <input
                        type="checkbox"
                        checked={sel.has(s.id)}
                        onChange={() => toggle(s.id)}
                        disabled={s.status !== 'stored'}
                        aria-label={`Elegir pajuela ${s.code ?? s.id.slice(0, 8)}`}
                      />
                    </td>
                    <td className="py-1.5">
                      {s.goblet_id ? (
                        cryoLocationLabel({
                          tank_code: s.tank_code,
                          canister_code: s.canister_code,
                          canister_color: s.canister_color,
                          goblet_code: s.goblet_code,
                        })
                      ) : (
                        <span className="text-warning">sin ubicar</span>
                      )}
                    </td>
                    <td className="py-1.5">
                      <CodeCell straw={s} busy={busy} onSave={(code) => call('PATCH', `/genetics/straws/${s.id}/code`, { code })} />
                    </td>
                    <td className="py-1.5">
                      <span className={s.status === 'stored' ? '' : 'text-ink-3'}>{ESTADO_ES[s.status]}</span>
                      {s.status_reason ? <span className="text-caption text-ink-3"> · {s.status_reason}</span> : null}
                    </td>
                    <td className="py-1.5 text-right">
                      {s.status === 'stored' ? (
                        <Select
                          value=""
                          onChange={(e) => e.target.value && call('PATCH', `/genetics/straws/${s.id}/status`, { status: e.target.value })}
                          controlSize="sm"
                          aria-label={`Dar de baja la pajuela ${s.code ?? s.id.slice(0, 8)}`}
                          className="w-44"
                        >
                          <option value="">Dar de baja…</option>
                          {(['lost', 'discarded', 'sold'] as const).map((k) => (
                            <option key={k} value={k}>
                              {STRAW_EXIT_REASONS[k]}
                            </option>
                          ))}
                        </Select>
                      ) : s.status === 'used' ? (
                        // Devolverla al stock dejaría un servicio apuntando a una pajuela entera.
                        <span className="text-caption text-ink-3">se usó en un servicio</span>
                      ) : (
                        <button
                          onClick={() => call('PATCH', `/genetics/straws/${s.id}/status`, { status: 'stored' })}
                          className="h-7 rounded-md border border-strong bg-surface px-2 text-label hover:bg-brand-soft"
                        >
                          Devolver al termo
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <input type="hidden" value={ownerParam} readOnly />
    </div>
  );
}

/** El código impreso se lee con la pajuela en la mano, así que se edita en la propia fila. */
function CodeCell({ straw, busy, onSave }: { straw: Straw; busy: boolean; onSave: (code: string) => void }) {
  const [valor, setValor] = useState(straw.code ?? '');
  const cambiado = valor.trim() !== (straw.code ?? '');
  return (
    <span className="flex items-center gap-1">
      <Input
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        placeholder="—"
        controlSize="sm"
        className="w-32"
        aria-label={`Código impreso de la pajuela ${straw.id.slice(0, 8)}`}
      />
      {cambiado && (
        <button onClick={() => onSave(valor)} disabled={busy} className="text-label text-brand hover:underline">
          guardar
        </button>
      )}
    </span>
  );
}
