'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { API_URL, authHeaders } from '@/lib/api';
import { Card, CardTitle } from '@/components/ui';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Select } from '@/components/Select';
import {
  FISCAL_DOCUMENT_TYPES,
  FISCAL_DOCUMENT_TYPE_LABEL,
  TAXABLE_TREATMENTS,
  VAT_TREATMENT_LABEL,
  type FiscalDocumentType,
  type VatTreatment,
} from '@cowinance/domain';

const money = (n: number) => `$${(n ?? 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** El estado del lote decide el color: agotarse no es un aviso administrativo, es no poder facturar. */
const HEALTH: Record<string, { label: string; cls: string }> = {
  ok: { label: '', cls: '' },
  low: { label: 'Quedan pocas formas', cls: 'text-warning' },
  exhausted: { label: 'Lote agotado', cls: 'text-danger' },
};

export function FiscalView({ series, rates, documents }: { series: any[]; rates: Record<string, number>; documents: any[] }) {
  const router = useRouter();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const post = async (path: string, body: any, method = 'POST') => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`${API_URL}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.title ?? `Error ${res.status}`);
      router.refresh();
      return true;
    } catch (e: any) {
      setError(e.message ?? 'No se pudo guardar.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      {error && (
        <p role="alert" className="text-label text-danger">
          {error}
        </p>
      )}
      <div className="grid grid-cols-2 gap-4 max-lg:grid-cols-1">
        <SeriesCard series={series} onSubmit={post} busy={busy} />
        <RatesCard rates={rates} onSubmit={post} busy={busy} />
      </div>
      <SalesBookCard documents={documents} />
    </div>
  );
}

function SeriesCard({ series, onSubmit, busy }: { series: any[]; onSubmit: any; busy: boolean }) {
  const [purpose, setPurpose] = useState<'document' | 'control'>('control');
  const [documentType, setDocumentType] = useState<FiscalDocumentType>('invoice');
  const [prefix, setPrefix] = useState('00');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  return (
    <Card className="self-start">
      <CardTitle>Series de numeración</CardTitle>
      <p className="mb-3 text-label text-ink-3">
        El número de control viene del lote que autorizó tu imprenta. El de documento es tu correlativo, uno por tipo de
        comprobante.
      </p>

      {series.length === 0 ? (
        <p className="py-2 text-label text-ink-3">Sin series todavía: sin ellas no se puede emitir.</p>
      ) : (
        <ul className="mb-4 divide-y divide-subtle">
          {series.map((s) => {
            const h = HEALTH[s.health] ?? HEALTH.ok;
            return (
              <li key={s.id} className="flex items-center justify-between py-2">
                <div>
                  <span className="text-body font-medium">
                    {s.purpose === 'control' ? 'Número de control' : FISCAL_DOCUMENT_TYPE_LABEL[s.document_type as FiscalDocumentType]}
                  </span>
                  <div className="text-label text-ink-3">
                    Próximo: {s.nextFormatted ?? '—'}
                    {s.remaining !== null && ` · quedan ${s.remaining}`}
                  </div>
                </div>
                {h.label && <span className={`text-label font-medium ${h.cls}`}>{h.label}</span>}
              </li>
            );
          })}
        </ul>
      )}

      <div className="space-y-2 border-t border-subtle pt-3">
        <Select value={purpose} onChange={(e) => setPurpose(e.target.value as any)} controlSize="sm" aria-label="Tipo de serie">
          <option value="control">Número de control (lote de la imprenta)</option>
          <option value="document">Correlativo de documento</option>
        </Select>
        {purpose === 'document' && (
          <Select value={documentType} onChange={(e) => setDocumentType(e.target.value as FiscalDocumentType)} controlSize="sm" aria-label="Tipo de comprobante">
            {FISCAL_DOCUMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {FISCAL_DOCUMENT_TYPE_LABEL[t]}
              </option>
            ))}
          </Select>
        )}
        <Input value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="Prefijo (00)" aria-label="Prefijo" />
        <div className="flex gap-2">
          <Input value={from} onChange={(e) => setFrom(e.target.value)} placeholder="Desde" aria-label="Desde" inputMode="numeric" />
          <Input value={to} onChange={(e) => setTo(e.target.value)} placeholder="Hasta" aria-label="Hasta" inputMode="numeric" />
        </div>
        <p className="text-label text-ink-3">Desde/hasta es el rango que autorizó la imprenta. Dejalo vacío si la serie no tiene tope.</p>
        <Button
          size="sm"
          fullWidth
          disabled={busy}
          onClick={() =>
            onSubmit('/tax/series', {
              purpose,
              document_type: purpose === 'document' ? documentType : undefined,
              prefix: prefix || undefined,
              range_from: from ? Number(from) : undefined,
              range_to: to ? Number(to) : undefined,
            })
          }
        >
          Abrir serie
        </Button>
      </div>
    </Card>
  );
}

function RatesCard({ rates, onSubmit, busy }: { rates: Record<string, number>; onSubmit: any; busy: boolean }) {
  // Se editan en PORCENTAJE, que es como se habla de ellas; se guardan como fracción, que es como
  // las usa el cálculo. La conversión va en un solo lugar.
  const [pct, setPct] = useState<Record<string, string>>(() =>
    Object.fromEntries(TAXABLE_TREATMENTS.map((t) => [t, rates[t] != null ? String(rates[t] * 100) : ''])),
  );

  return (
    <Card className="self-start">
      <CardTitle>Alícuotas de IVA</CardTitle>
      <p className="mb-3 text-label text-ink-3">
        Se cargan en porcentaje. Cambian por providencia: cambiarlas acá no afecta los comprobantes ya emitidos, que
        conservan la alícuota de su fecha.
      </p>
      <div className="space-y-2">
        {TAXABLE_TREATMENTS.map((t) => (
          <div key={t} className="flex items-center gap-2">
            <span className="w-40 shrink-0 text-label text-ink-2">{VAT_TREATMENT_LABEL[t as VatTreatment]}</span>
            <Input
              value={pct[t] ?? ''}
              onChange={(e) => setPct({ ...pct, [t]: e.target.value })}
              placeholder="—"
              inputMode="decimal"
              aria-label={VAT_TREATMENT_LABEL[t as VatTreatment]}
            />
            <span className="text-label text-ink-3">%</span>
          </div>
        ))}
        <Button
          size="sm"
          fullWidth
          disabled={busy}
          onClick={() =>
            onSubmit(
              '/tax/vat-rates',
              {
                rates: Object.fromEntries(
                  Object.entries(pct)
                    .filter(([, v]) => v !== '')
                    .map(([k, v]) => [k, Number(v) / 100]),
                ),
              },
              'PUT',
            )
          }
        >
          Guardar alícuotas
        </Button>
      </div>
    </Card>
  );
}

function SalesBookCard({ documents }: { documents: any[] }) {
  return (
    <Card>
      <CardTitle action={<span className="text-label text-ink-3">{documents.length} comprobantes</span>}>
        Comprobantes emitidos
      </CardTitle>
      {documents.length === 0 ? (
        <p className="py-3 text-center text-label text-ink-3">Todavía no se emitió ninguno.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-body">
            <thead>
              <tr className="text-left text-label text-ink-3">
                <th className="py-1 pr-4 font-medium">Control</th>
                <th className="py-1 pr-4 font-medium">Documento</th>
                <th className="py-1 pr-4 font-medium">Tipo</th>
                <th className="py-1 pr-4 font-medium">Fecha</th>
                <th className="py-1 pr-4 font-medium">Cliente</th>
                <th className="py-1 pr-4 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-subtle">
              {documents.map((d) => (
                <tr key={d.id} className={d.standing === 'voided' ? 'text-ink-3' : ''}>
                  <td className="py-1.5 pr-4 tabular-nums">{d.control_number}</td>
                  <td className="py-1.5 pr-4 tabular-nums">{d.invoice_number}</td>
                  <td className="py-1.5 pr-4">
                    {FISCAL_DOCUMENT_TYPE_LABEL[d.document_type as FiscalDocumentType] ?? d.document_type}
                    {/* Un anulado se muestra igual: conserva su número y el correlativo tiene que
                        poder recorrerse entero. */}
                    {d.standing === 'voided' && <span className="ml-2 text-caption font-medium text-danger">ANULADO</span>}
                  </td>
                  <td className="py-1.5 pr-4">{String(d.issue_date).slice(0, 10)}</td>
                  <td className="py-1.5 pr-4">{d.partner_name}</td>
                  <td className="py-1.5 pr-4 text-right tabular-nums">{d.standing === 'voided' ? '—' : money(d.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
