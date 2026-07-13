'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { API_URL, authHeaders } from '@/lib/api';
import { Card, CardTitle } from '@/components/ui';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Select } from '@/components/Select';

interface Named {
  id: string;
  name: string;
}
interface ItemOpt {
  id: string;
  name: string;
  unit: string;
}
interface AnimalOpt {
  id: string;
  tag: string | null;
  name: string | null;
}

interface Line {
  target: 'item' | 'animal';
  item_id: string;
  animal_id: string;
  warehouse_id: string;
  quantity: string;
  unit_price: string;
  tax_rate: string;
}

const SALE_TYPES: [string, string][] = [
  ['livestock', 'Hacienda'],
  ['product', 'Producto'],
  ['milk', 'Leche'],
  ['crop', 'Grano'],
  ['service', 'Servicio'],
  ['other', 'Otro'],
];

const emptyLine = (target: 'item' | 'animal'): Line => ({ target, item_id: '', animal_id: '', warehouse_id: '', quantity: '', unit_price: '', tax_rate: '0' });
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Formulario reusable de alta de un documento comercial (compra o venta) con líneas dinámicas. El
 * total es solo un PREVIEW en cliente: el número autoritativo lo calcula y devuelve el servidor.
 */
export function DocumentForm({
  kind,
  partners,
  items,
  warehouses,
  animals,
}: {
  kind: 'purchase' | 'sale';
  partners: Named[];
  items: ItemOpt[];
  warehouses: Named[];
  animals: AnimalOpt[];
}) {
  const router = useRouter();
  const isSale = kind === 'sale';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [partnerId, setPartnerId] = useState(partners[0]?.id ?? '');
  const [saleType, setSaleType] = useState('livestock');
  const [docNumber, setDocNumber] = useState('');
  const [lines, setLines] = useState<Line[]>([emptyLine('item')]);

  const setLine = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const addLine = (target: 'item' | 'animal') => setLines((ls) => [...ls, emptyLine(target)]);
  const removeLine = (i: number) => setLines((ls) => (ls.length > 1 ? ls.filter((_, idx) => idx !== i) : ls));

  const previewTotal = round2(
    lines.reduce((sum, l) => {
      const q = Number(l.quantity);
      const p = Number(l.unit_price);
      const r = Number(l.tax_rate) || 0;
      if (!Number.isFinite(q) || !Number.isFinite(p)) return sum;
      const lt = round2(q * p);
      return sum + lt + round2(lt * r);
    }, 0),
  );

  async function submit() {
    if (busy) return;
    if (!partnerId) return setError(isSale ? 'Elegí un cliente.' : 'Elegí un proveedor.');
    const payloadLines = lines.map((l) => ({
      item_id: l.target === 'item' ? l.item_id || undefined : undefined,
      animal_id: l.target === 'animal' ? l.animal_id || undefined : undefined,
      warehouse_id: !isSale && l.target === 'item' ? l.warehouse_id || undefined : undefined,
      quantity: Number(l.quantity),
      unit_price: Number(l.unit_price),
      tax_rate: Number(l.tax_rate) || 0,
    }));
    if (payloadLines.some((l) => !l.item_id && !l.animal_id)) return setError('Cada línea necesita un ítem o un animal.');
    if (payloadLines.some((l) => !(l.quantity > 0) || !(l.unit_price >= 0))) return setError('Cantidad y precio deben ser válidos.');
    if (!isSale && payloadLines.some((l) => l.item_id && !l.warehouse_id)) return setError('Cada línea de ítem necesita un depósito.');

    setBusy(true);
    setError('');
    try {
      const body: any = { document_number: docNumber || undefined, lines: payloadLines };
      if (isSale) {
        body.customer_partner_id = partnerId;
        body.type = saleType;
      } else {
        body.supplier_partner_id = partnerId;
      }
      const res = await fetch(`${API_URL}/commerce/${isSale ? 'sales' : 'purchases'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.title ?? `Error ${res.status}`);
      }
      setLines([emptyLine('item')]);
      setDocNumber('');
      router.refresh();
    } catch (e: any) {
      setError(e.message ?? 'No se pudo guardar.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="self-start">
      <CardTitle>{isSale ? 'Nueva venta' : 'Nueva compra'}</CardTitle>
      {error && (
        <p role="alert" className="mb-2 text-label text-danger">
          {error}
        </p>
      )}
      <div className="space-y-2">
        <Select value={partnerId} onChange={(e) => setPartnerId(e.target.value)} aria-label={isSale ? 'Cliente' : 'Proveedor'}>
          <option value="">{isSale ? 'Elegí cliente…' : 'Elegí proveedor…'}</option>
          {partners.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
        {isSale && (
          <Select value={saleType} onChange={(e) => setSaleType(e.target.value)} controlSize="sm" aria-label="Tipo de venta">
            {SALE_TYPES.map(([c, l]) => (
              <option key={c} value={c}>
                {l}
              </option>
            ))}
          </Select>
        )}
        <Input value={docNumber} onChange={(e) => setDocNumber(e.target.value)} placeholder="N° de comprobante (opcional)" aria-label="Número de comprobante" />

        <div className="space-y-2 border-t border-subtle pt-2">
          {lines.map((l, i) => (
            <div key={i} className="space-y-1 rounded border border-subtle p-2">
              {l.target === 'item' ? (
                <Select value={l.item_id} onChange={(e) => setLine(i, { item_id: e.target.value })} controlSize="sm" aria-label={`Ítem línea ${i + 1}`}>
                  <option value="">Elegí ítem…</option>
                  {items.map((it) => (
                    <option key={it.id} value={it.id}>
                      {it.name} ({it.unit})
                    </option>
                  ))}
                </Select>
              ) : (
                <Select value={l.animal_id} onChange={(e) => setLine(i, { animal_id: e.target.value })} controlSize="sm" aria-label={`Animal línea ${i + 1}`}>
                  <option value="">Elegí animal…</option>
                  {animals.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.tag ?? a.name ?? a.id.slice(0, 8)}
                    </option>
                  ))}
                </Select>
              )}
              {kind === 'purchase' && l.target === 'item' && (
                <Select value={l.warehouse_id} onChange={(e) => setLine(i, { warehouse_id: e.target.value })} controlSize="sm" aria-label={`Depósito línea ${i + 1}`}>
                  <option value="">Elegí depósito…</option>
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </Select>
              )}
              <div className="flex gap-1">
                <Input type="number" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} placeholder="Cant." aria-label={`Cantidad línea ${i + 1}`} />
                <Input type="number" value={l.unit_price} onChange={(e) => setLine(i, { unit_price: e.target.value })} placeholder="Precio" aria-label={`Precio línea ${i + 1}`} />
                <Input type="number" value={l.tax_rate} onChange={(e) => setLine(i, { tax_rate: e.target.value })} placeholder="IVA" aria-label={`Alícuota línea ${i + 1}`} />
                {lines.length > 1 && (
                  <Button secondary size="sm" onClick={() => removeLine(i)} aria-label={`Quitar línea ${i + 1}`}>
                    ✕
                  </Button>
                )}
              </div>
            </div>
          ))}
          <div className="flex gap-2">
            <Button secondary size="sm" onClick={() => addLine('item')}>
              + Ítem
            </Button>
            {isSale && (
              <Button secondary size="sm" onClick={() => addLine('animal')}>
                + Animal
              </Button>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-subtle pt-2">
          <span className="text-label text-ink-3">
            Total (preview) <span className="tnum font-medium text-ink-1">{previewTotal}</span>
          </span>
          <Button size="sm" loading={busy} disabled={busy} onClick={submit}>
            {isSale ? 'Crear venta' : 'Crear compra'}
          </Button>
        </div>
      </div>
    </Card>
  );
}
