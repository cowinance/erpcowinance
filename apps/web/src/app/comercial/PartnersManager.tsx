'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { API_URL, authHeaders } from '@/lib/api';
import { Card, CardTitle } from '@/components/ui';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Select } from '@/components/Select';
import { TAXPAYER_CONDITIONS, TAXPAYER_CONDITION_HINT, TAXPAYER_CONDITION_LABEL, isValidRif, type TaxpayerCondition } from '@cowinance/domain';

interface Partner {
  id: string;
  type: 'customer' | 'supplier' | 'both';
  name: string;
  tax_id: string | null;
  taxpayer_condition: TaxpayerCondition | null;
  email: string | null;
  is_active: boolean;
  supplier_category: string | null;
  customer_segment: string | null;
}

const TYPES: [string, string][] = [
  ['customer', 'Cliente'],
  ['supplier', 'Proveedor'],
  ['both', 'Ambos'],
];
const CATEGORIES: [string, string][] = [
  ['feed', 'Alimento'],
  ['veterinary', 'Veterinario'],
  ['genetics', 'Genética'],
  ['machinery', 'Maquinaria'],
  ['fuel', 'Combustible'],
  ['services', 'Servicios'],
  ['other', 'Otro'],
];
const SEGMENTS: [string, string][] = [
  ['slaughterhouse', 'Frigorífico'],
  ['dairy', 'Tambo'],
  ['auction', 'Remate'],
  ['breeder', 'Cabaña'],
  ['retail', 'Minorista'],
  ['export', 'Exportación'],
  ['other', 'Otro'],
];
const typeLabel = (k: string) => TYPES.find(([c]) => c === k)?.[1] ?? k;
const catLabel = (k: string | null) => (k ? CATEGORIES.find(([c]) => c === k)?.[1] ?? k : null);
const segLabel = (k: string | null) => (k ? SEGMENTS.find(([c]) => c === k)?.[1] ?? k : null);

export function PartnersManager({ partners, countryCode }: { partners: Partner[]; countryCode?: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [type, setType] = useState('customer');
  const [name, setName] = useState('');
  const [taxId, setTaxId] = useState('');
  const [condition, setCondition] = useState('');
  const [email, setEmail] = useState('');
  const [category, setCategory] = useState('feed');
  const [segment, setSegment] = useState('slaughterhouse');

  const wantSupplier = type === 'supplier' || type === 'both';
  const wantCustomer = type === 'customer' || type === 'both';

  const esVenezuela = countryCode === 'VE';
  const idLabel = esVenezuela ? 'RIF' : 'Identificación fiscal';
  // Mismo `isValidRif` que usa la API — la regla vive una sola vez, en el dominio. Acá solo se
  // adelanta el aviso: el servidor valida igual, esto le ahorra al usuario mandar y esperar.
  const rifMalCargado = esVenezuela && taxId.trim() !== '' && !isValidRif(taxId);

  async function create() {
    if (busy) return;
    if (!name.trim()) return setError('El nombre es obligatorio.');
    setBusy(true);
    setError('');
    try {
      const data: any = { type, name: name.trim(), tax_id: taxId || undefined, email: email || undefined };
      if (condition) data.taxpayer_condition = condition;
      if (wantSupplier) data.supplier_category = category;
      if (wantCustomer) data.customer_segment = segment;
      const res = await fetch(`${API_URL}/commerce/partners`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify(data) });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.title ?? `Error ${res.status}`);
      }
      setName('');
      setTaxId('');
      setCondition('');
      setEmail('');
      router.refresh();
    } catch (e: any) {
      setError(e.message ?? 'No se pudo guardar.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid grid-cols-3 gap-4 max-lg:grid-cols-1">
      {/* Alta */}
      <Card className="self-start">
        <CardTitle>Nuevo socio</CardTitle>
        {error && (
          <p role="alert" className="mb-2 text-label text-danger">
            {error}
          </p>
        )}
        <div className="space-y-2">
          <Select value={type} onChange={(e) => setType(e.target.value)} aria-label="Tipo de socio">
            {TYPES.map(([c, l]) => (
              <option key={c} value={c}>
                {l}
              </option>
            ))}
          </Select>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre / razón social" aria-label="Nombre del socio" />
          <div>
            <Input
              value={taxId}
              onChange={(e) => setTaxId(e.target.value)}
              placeholder={esVenezuela ? 'RIF (J-00123072-6)' : 'CUIT / identificación fiscal'}
              aria-label={idLabel}
              aria-invalid={rifMalCargado || undefined}
            />
            {rifMalCargado && (
              <p className="mt-1 text-label text-danger">El dígito verificador no corresponde: revisá el número.</p>
            )}
          </div>
          <div>
            <Select value={condition} onChange={(e) => setCondition(e.target.value)} controlSize="sm" aria-label="Condición ante el IVA">
              <option value="">Condición ante el IVA…</option>
              {TAXPAYER_CONDITIONS.map((c) => (
                <option key={c} value={c}>
                  {TAXPAYER_CONDITION_LABEL[c]}
                </option>
              ))}
            </Select>
            {condition && <p className="mt-1 text-label text-ink-3">{TAXPAYER_CONDITION_HINT[condition as TaxpayerCondition]}</p>}
          </div>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" aria-label="Email" />
          {wantSupplier && (
            <Select value={category} onChange={(e) => setCategory(e.target.value)} controlSize="sm" aria-label="Rubro de proveedor">
              {CATEGORIES.map(([c, l]) => (
                <option key={c} value={c}>
                  Proveedor: {l}
                </option>
              ))}
            </Select>
          )}
          {wantCustomer && (
            <Select value={segment} onChange={(e) => setSegment(e.target.value)} controlSize="sm" aria-label="Segmento de cliente">
              {SEGMENTS.map(([c, l]) => (
                <option key={c} value={c}>
                  Cliente: {l}
                </option>
              ))}
            </Select>
          )}
          <Button size="sm" fullWidth loading={busy} disabled={busy || rifMalCargado} onClick={create}>
            Agregar socio
          </Button>
        </div>
      </Card>

      {/* Listado */}
      <Card className="col-span-2 self-start max-lg:col-span-3">
        <CardTitle action={<span className="text-label text-ink-3">{partners.length} socios</span>}>Socios</CardTitle>
        {partners.length === 0 ? (
          <p className="py-3 text-center text-label text-ink-3">Sin socios todavía.</p>
        ) : (
          <ul className="divide-y divide-subtle">
            {partners.map((p) => (
              <li key={p.id} className="flex items-center justify-between py-2">
                <div>
                  <span className={p.is_active ? 'text-body font-medium' : 'text-body text-ink-3 line-through'}>{p.name}</span>
                  {p.tax_id && <span className="ml-2 text-label text-ink-3">{p.tax_id}</span>}
                  {/* El especial se marca aparte: es el que RETIENE el IVA al pagar, así que la
                      factura dice un número y el banco muestra otro. Quien carga la cobranza tiene
                      que verlo sin abrir la ficha. */}
                  {p.taxpayer_condition === 'especial' && (
                    <span className="ml-2 rounded-full bg-subtle px-2 py-0.5 text-caption font-medium text-ink-2">Retiene IVA</span>
                  )}
                  <div className="text-label text-ink-3">
                    {[
                      catLabel(p.supplier_category) && `Prov: ${catLabel(p.supplier_category)}`,
                      segLabel(p.customer_segment) && `Cli: ${segLabel(p.customer_segment)}`,
                      p.taxpayer_condition && TAXPAYER_CONDITION_LABEL[p.taxpayer_condition],
                    ]
                      .filter(Boolean)
                      .join(' · ') || p.email}
                  </div>
                </div>
                <span className="rounded-full bg-subtle px-2 py-0.5 text-caption font-medium text-ink-2">{typeLabel(p.type)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
