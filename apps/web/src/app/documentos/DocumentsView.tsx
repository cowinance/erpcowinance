'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { API_URL, authHeaders, fileUrl } from '@/lib/api';
import { Card, CardTitle, KpiCard, EmptyState } from '@/components/ui';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Select } from '@/components/Select';

interface Doc {
  id: string;
  type: string;
  title: string;
  issued_by: string | null;
  issue_date: string | null;
  expiry_date: string | null;
  is_expired: boolean;
  days_to_expiry: number | null;
  file: { file_id: string; token: string; mime: string };
}
interface Summary { total: number; expired: number; expiring_soon: number }

const TYPES: [string, string][] = [
  ['certificate', 'Certificado'], ['contract', 'Contrato'], ['invoice', 'Factura'],
  ['health_guide', 'Guía sanitaria'], ['report', 'Informe'], ['permit', 'Permiso'], ['other', 'Otro'],
];
const TYPE_ES = Object.fromEntries(TYPES) as Record<string, string>;

function ExpiryBadge({ d }: { d: Doc }) {
  if (d.expiry_date == null) return <span className="text-caption text-ink-3">Sin vencimiento</span>;
  if (d.is_expired) return <span className="rounded bg-danger/10 px-1.5 py-0.5 text-caption text-danger">Vencido</span>;
  if (d.days_to_expiry != null && d.days_to_expiry <= 30) return <span className="rounded bg-warning/10 px-1.5 py-0.5 text-caption text-warning">Vence en {d.days_to_expiry} d</span>;
  return <span className="rounded bg-success/10 px-1.5 py-0.5 text-caption text-success">Vigente</span>;
}

export function DocumentsView({ docs, summary }: { docs: Doc[]; summary: Summary }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [type, setType] = useState('certificate');
  const [title, setTitle] = useState('');
  const [issuedBy, setIssuedBy] = useState('');
  const [issueDate, setIssueDate] = useState('');
  const [expiryDate, setExpiryDate] = useState('');

  async function toDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }

  async function submit() {
    const file = inputRef.current?.files?.[0];
    if (!file || !title.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      const dataUrl = await toDataUrl(file);
      const res = await fetch(`${API_URL}/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ type, title, issued_by: issuedBy || undefined, issue_date: issueDate || undefined, expiry_date: expiryDate || undefined, data_url: dataUrl }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.title ?? `Error ${res.status}`);
      setTitle(''); setIssuedBy(''); setIssueDate(''); setExpiryDate('');
      if (inputRef.current) inputRef.current.value = '';
      router.refresh();
    } catch (e: any) {
      setError(e.message ?? 'No se pudo subir el documento.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (busy) return;
    setBusy(true);
    try {
      await fetch(`${API_URL}/documents/${id}`, { method: 'DELETE', headers: authHeaders() });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-4 max-sm:grid-cols-1">
        <KpiCard label="Documentos" value={summary.total} />
        <KpiCard label="Por vencer (30 d)" value={summary.expiring_soon} tone={summary.expiring_soon > 0 ? 'warning' : undefined} hint="Vencen en los próximos 30 días" />
        <KpiCard label="Vencidos" value={summary.expired} tone={summary.expired > 0 ? 'danger' : undefined} />
      </div>

      <div className="grid grid-cols-3 gap-4 max-lg:grid-cols-1">
        <Card className="self-start">
          <CardTitle>Nuevo documento</CardTitle>
          {error && <p role="alert" className="mb-2 text-label text-danger">{error}</p>}
          <div className="space-y-2">
            <Select value={type} onChange={(e) => setType(e.target.value)} aria-label="Tipo">
              {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Título" aria-label="Título" />
            <Input value={issuedBy} onChange={(e) => setIssuedBy(e.target.value)} placeholder="Emisor (opcional)" aria-label="Emisor" />
            <label className="block text-label text-ink-2">Emisión<div className="mt-1"><Input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} aria-label="Fecha de emisión" /></div></label>
            <label className="block text-label text-ink-2">Vencimiento<div className="mt-1"><Input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} aria-label="Fecha de vencimiento" /></div></label>
            <input ref={inputRef} type="file" accept="application/pdf,image/png,image/jpeg,image/webp" className="block w-full text-label text-ink-2 file:mr-2 file:rounded file:border file:border-subtle file:bg-sunken file:px-2 file:py-1 file:text-label" aria-label="Archivo" />
            <Button size="sm" fullWidth loading={busy} disabled={busy || !title.trim()} onClick={submit}>Subir documento</Button>
          </div>
        </Card>

        <Card className="col-span-2 self-start max-lg:col-span-3">
          <CardTitle action={<span className="text-label text-ink-3">{docs.length}</span>}>Documentos</CardTitle>
          {docs.length === 0 ? (
            <EmptyState title="Sin documentos" body="Subí certificados, contratos o permisos y seguí su vencimiento." />
          ) : (
            <ul className="divide-y divide-subtle">
              {docs.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <a href={fileUrl(d.file) ?? '#'} target="_blank" rel="noopener noreferrer" className="truncate text-body font-medium text-brand hover:underline">{d.title}</a>
                      <ExpiryBadge d={d} />
                    </div>
                    <div className="text-label text-ink-3">
                      {TYPE_ES[d.type] ?? d.type}
                      {d.issued_by ? ` · ${d.issued_by}` : ''}
                      {d.expiry_date ? ` · vence ${String(d.expiry_date).slice(0, 10)}` : ''}
                    </div>
                  </div>
                  <Button variant="secondary" size="sm" disabled={busy} onClick={() => remove(d.id)} aria-label={`Borrar ${d.title}`}>✕</Button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
