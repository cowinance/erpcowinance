'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { API_URL, authHeaders } from '@/lib/api';
import { Card, CardTitle } from '@/components/ui';
import { Button } from '@/components/Button';

interface Doc {
  id: string;
  document_number: string | null;
  party_name: string;
  total: number;
  currency: string;
  status: string;
  date: string;
}

interface SchemeCheck {
  scheme: string;
  verdict: 'ok' | 'vencida' | 'por_vencer' | 'suspendida' | 'parcial' | 'sin_cobertura';
  message: string;
  uncoveredTags: string[];
}
interface CertCheck {
  animals: number;
  hasWarnings: boolean;
  schemes: SchemeCheck[];
}

/** Un aviso NO es un bloqueo: el sistema no sabe qué le exige el comprador a esta venta. */
const VERDICT: Record<string, { label: string; tone: string }> = {
  vencida: { label: 'Certificación vencida', tone: 'border-danger/30 bg-danger/10 text-danger' },
  suspendida: { label: 'Certificación suspendida', tone: 'border-danger/30 bg-danger/10 text-danger' },
  sin_cobertura: { label: 'Sin cobertura', tone: 'border-warning/30 bg-warning/10 text-warning' },
  parcial: { label: 'Venta mixta', tone: 'border-warning/30 bg-warning/10 text-warning' },
  por_vencer: { label: 'Vence pronto', tone: 'border-subtle text-ink-3' },
};

const STATUS_LABEL: Record<string, string> = {
  draft: 'Borrador',
  confirmed: 'Confirmada',
  received: 'Recibida',
  delivered: 'Entregada',
  invoiced: 'Facturada',
  paid: 'Pagada',
  canceled: 'Anulada',
};

// Acciones ofrecidas por estado (la API valida la transición real; el web solo ofrece los botones).
const ACTIONS: Record<'purchase' | 'sale', Record<string, [string, string][]>> = {
  purchase: {
    draft: [['confirmed', 'Confirmar'], ['received', 'Recibir'], ['canceled', 'Anular']],
    confirmed: [['received', 'Recibir'], ['canceled', 'Anular']],
    received: [['paid', 'Pagar']],
  },
  sale: {
    draft: [['confirmed', 'Confirmar'], ['delivered', 'Entregar'], ['canceled', 'Anular']],
    confirmed: [['delivered', 'Entregar'], ['canceled', 'Anular']],
    delivered: [['invoiced', 'Facturar'], ['paid', 'Pagar']],
    invoiced: [['paid', 'Pagar']],
  },
};

export function DocumentList({
  kind,
  docs,
  certifications = {},
  uncheckedCount = 0,
}: {
  kind: 'purchase' | 'sale';
  docs: Doc[];
  /** Chequeo de certificaciones por venta (Fase 3.3). Solo lo manda la pantalla de ventas. */
  certifications?: Record<string, CertCheck | null>;
  /** Ventas abiertas que quedaron sin revisar por el tope: se dice, no se esconde. */
  uncheckedCount?: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const path = kind === 'sale' ? 'sales' : 'purchases';

  async function transition(id: string, status: string) {
    if (busy) return;
    setBusy(id + status);
    setError('');
    try {
      const res = await fetch(`${API_URL}/commerce/${path}/${id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.title ?? `Error ${res.status}`);
      }
      router.refresh();
    } catch (e: any) {
      setError(e.message ?? 'No se pudo actualizar.');
    } finally {
      setBusy('');
    }
  }

  return (
    <Card className="col-span-2 self-start max-lg:col-span-3">
      <CardTitle action={<span className="text-label text-ink-3">{docs.length}</span>}>{kind === 'sale' ? 'Ventas' : 'Compras'}</CardTitle>
      {error && (
        <p role="alert" className="mb-2 text-label text-danger">
          {error}
        </p>
      )}
      {uncheckedCount > 0 && (
        <p className="mb-2 text-caption text-ink-3">
          {uncheckedCount} venta{uncheckedCount === 1 ? '' : 's'} abierta{uncheckedCount === 1 ? '' : 's'} sin revisar la certificación: se revisan las 20 más
          recientes.
        </p>
      )}
      {docs.length === 0 ? (
        <p className="py-3 text-center text-label text-ink-3">Sin {kind === 'sale' ? 'ventas' : 'compras'} todavía.</p>
      ) : (
        <ul className="divide-y divide-subtle">
          {docs.map((d) => (
            <li key={d.id} className="py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="text-body font-medium">{d.party_name}</span>
                  <span className="ml-2 text-label text-ink-3">{d.document_number ?? d.date}</span>
                  <div className="text-label text-ink-3">
                    <span className="tnum">{d.total}</span> {d.currency}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-subtle px-2 py-0.5 text-caption font-medium text-ink-2">{STATUS_LABEL[d.status] ?? d.status}</span>
                  {(ACTIONS[kind][d.status] ?? []).map(([to, label]) => (
                    <Button key={to} variant="secondary" size="sm" loading={busy === d.id + to} disabled={!!busy} onClick={() => transition(d.id, to)}>
                      {label}
                    </Button>
                  ))}
                </div>
              </div>
              <Certifications check={certifications[d.id]} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/**
 * El aviso de certificación de una venta (Fase 3.3).
 *
 * Va pegado a la fila y ARRIBA del botón «Entregar», que es el momento en que importa: hoy el
 * problema aparece en el control, con el camión cargado, y el dato estaba en el sistema desde hacía
 * meses.
 *
 * Solo se muestra lo que hay que mirar. Un «todo en orden» en cada venta entrena a saltear el
 * renglón, y entonces el aviso que sí importa tampoco se lee.
 */
function Certifications({ check }: { check?: CertCheck | null }) {
  if (!check || !check.hasWarnings) return null;
  const avisos = check.schemes.filter((s) => s.verdict !== 'ok');
  return (
    <div className="mt-1.5 space-y-1 border-l-2 border-warning/40 pl-2">
      {avisos.map((s) => (
        <div key={s.scheme}>
          <span className={`rounded-full border px-2 py-0.5 text-caption font-medium ${VERDICT[s.verdict]?.tone ?? 'border-subtle text-ink-3'}`}>
            {VERDICT[s.verdict]?.label ?? s.verdict}
          </span>
          <p className="mt-0.5 text-caption text-ink-3">{s.message}</p>
          {s.uncoveredTags.length > 0 && s.verdict === 'parcial' && (
            <p className="text-caption text-ink-3">Sin cubrir: caravanas {s.uncoveredTags.join(', ')}.</p>
          )}
        </div>
      ))}
    </div>
  );
}
