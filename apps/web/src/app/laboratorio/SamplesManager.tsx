'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { API_URL, authHeaders } from '@/lib/api';
import { Card, CardTitle } from '@/components/ui';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Select } from '@/components/Select';

interface Lab {
  id: string;
  name: string;
}
interface Animal {
  id: string;
  tag?: string;
  name?: string;
}
interface Paddock {
  id: string;
  name: string;
}
interface Sample {
  id: string;
  sample_type: string;
  lab_name: string | null;
  animal_id: string | null;
  animal_tag: string | null;
  paddock_id: string | null;
  paddock_name: string | null;
  collected_at: string;
  status: string;
  is_open: boolean;
  result_count: number;
  abnormal_count: number;
}
interface Result {
  id: string;
  test_code: string;
  result_value: string | null;
  reference_range: string | null;
  is_abnormal: boolean | null;
  /** El laboratorio dijo QUÉ es, no solo que está raro: es lo que dispara el caso clínico (Fase 3.1). */
  diagnosis_id: string | null;
  diagnosis: string | null;
  is_notifiable: boolean | null;
  clinical_case_id: string | null;
}
interface Diagnosis {
  id: string;
  name: string;
  is_notifiable: boolean | null;
}

const SAMPLE_TYPES = ['blood', 'tissue', 'milk', 'soil', 'hair', 'semen', 'feces', 'other'];
const SAMPLE_TYPE_ES: Record<string, string> = { blood: 'Sangre', tissue: 'Tejido', milk: 'Leche', soil: 'Suelo', hair: 'Pelo', semen: 'Semen', feces: 'Materia fecal', other: 'Otro' };
const STATUS: Record<string, string> = { collected: 'Tomada', sent: 'Enviada', in_progress: 'En proceso', completed: 'Completada', rejected: 'Rechazada' };
const ACTIONS: Record<string, [string, string][]> = {
  collected: [['sent', 'Enviar'], ['rejected', 'Rechazar']],
  sent: [['in_progress', 'En proceso'], ['completed', 'Completar'], ['rejected', 'Rechazar']],
  in_progress: [['completed', 'Completar'], ['rejected', 'Rechazar']],
};
const RESULTABLE = ['sent', 'in_progress', 'completed'];

export function SamplesManager({ samples, labs, animals, paddocks, diagnoses }: { samples: Sample[]; labs: Lab[]; animals: Animal[]; paddocks: Paddock[]; diagnoses: Diagnosis[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sampleType, setSampleType] = useState('blood');
  const [animalId, setAnimalId] = useState('');
  const [paddockId, setPaddockId] = useState('');
  const [labId, setLabId] = useState('');
  const [barcode, setBarcode] = useState('');
  const [selected, setSelected] = useState<Sample | null>(null);
  const [results, setResults] = useState<Result[]>([]);
  const [testCode, setTestCode] = useState('');
  const [resultValue, setResultValue] = useState('');
  const [refRange, setRefRange] = useState('');
  const [abnormal, setAbnormal] = useState(false);
  const [diagnosisId, setDiagnosisId] = useState('');
  /** Lo que el backend decidió con el último resultado: se muestra tal cual, incluido el «no se abrió porque…». */
  const [veredicto, setVeredicto] = useState<{ opensCase: boolean; explanation: string } | null>(null);
  /** Diagnóstico elegido por fila para abrir el caso a mano. */
  const [caseDiagnosis, setCaseDiagnosis] = useState<Record<string, string>>({});

  async function call(method: string, path: string, data?: any) {
    const res = await fetch(`${API_URL}${path}`, { method, headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: data ? JSON.stringify(data) : undefined });
    if (!res.ok) {
      const j = await res.json().catch(() => null);
      throw new Error(j?.title ?? `Error ${res.status}`);
    }
    return res.json().catch(() => null);
  }

  async function run(fn: () => Promise<any>) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e: any) {
      setError(e.message ?? 'No se pudo guardar.');
    } finally {
      setBusy(false);
    }
  }

  const createSample = () =>
    run(async () => {
      await call('POST', '/lab/samples', { sample_type: sampleType, animal_id: animalId || null, paddock_id: paddockId || null, lab_id: labId || null, barcode: barcode || null });
      setBarcode('');
      setAnimalId('');
      setPaddockId('');
      router.refresh();
    });

  const transition = (s: Sample, to: string) =>
    run(async () => {
      await call('PATCH', `/lab/samples/${s.id}/status`, { status: to });
      if (selected?.id === s.id) setSelected({ ...s, status: to });
      router.refresh();
    });

  const openResults = (s: Sample) =>
    run(async () => {
      const rows = await call('GET', `/lab/samples/${s.id}/results`);
      setSelected(s);
      setResults(rows ?? []);
      setVeredicto(null);
    });

  const addResult = () =>
    run(async () => {
      if (!selected) return;
      const creado = await call('POST', `/lab/samples/${selected.id}/results`, {
        test_code: testCode,
        result_value: resultValue || null,
        reference_range: refRange || null,
        is_abnormal: abnormal,
        diagnosis_id: diagnosisId || null,
      });
      setTestCode('');
      setResultValue('');
      setRefRange('');
      setAbnormal(false);
      setDiagnosisId('');
      // Solo se muestra el veredicto de un resultado anormal: en uno normal, «no se abrió caso» es
      // obvio y decirlo cada vez entrena a ignorar el aviso.
      setVeredicto(creado?.is_abnormal ? (creado?.case_assessment ?? null) : null);
      const rows = await call('GET', `/lab/samples/${selected.id}/results`);
      setResults(rows ?? []);
      router.refresh();
    });

  /** Abre el caso a mano cuando el resultado no traía diagnóstico: el clic que reemplaza retipear. */
  const openCase = (r: Result, diagnosis: string) =>
    run(async () => {
      if (!selected) return;
      await call('POST', `/lab/results/${r.id}/clinical-case`, { diagnosis_id: diagnosis });
      const rows = await call('GET', `/lab/samples/${selected.id}/results`);
      setResults(rows ?? []);
      setVeredicto(null);
      router.refresh();
    });

  const animalLabel = (a: Animal) => a.tag ?? a.name ?? a.id.slice(0, 8);

  return (
    <div className="grid grid-cols-3 gap-4 max-lg:grid-cols-1">
      <Card className="self-start">
        <CardTitle>Nueva muestra</CardTitle>
        {error && <p role="alert" className="mb-2 text-label text-danger">{error}</p>}
        <div className="space-y-2">
          <Select value={sampleType} onChange={(e) => setSampleType(e.target.value)} aria-label="Tipo de muestra">
            {SAMPLE_TYPES.map((t) => (
              <option key={t} value={t}>
                {SAMPLE_TYPE_ES[t]}
              </option>
            ))}
          </Select>
          <Select value={animalId} onChange={(e) => setAnimalId(e.target.value)} controlSize="sm" aria-label="Animal (opcional)">
            <option value="">Sin animal…</option>
            {animals.map((a) => (
              <option key={a.id} value={a.id}>
                {animalLabel(a)}
              </option>
            ))}
          </Select>
          <Select value={paddockId} onChange={(e) => setPaddockId(e.target.value)} controlSize="sm" aria-label="Potrero (opcional)">
            <option value="">Sin potrero…</option>
            {paddocks.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
          <Select value={labId} onChange={(e) => setLabId(e.target.value)} controlSize="sm" aria-label="Laboratorio (opcional)">
            <option value="">Sin laboratorio…</option>
            {labs.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
          <Input value={barcode} onChange={(e) => setBarcode(e.target.value)} placeholder="Código de barras (opcional)" aria-label="Código de barras" />
          <Button size="sm" fullWidth loading={busy} disabled={busy} onClick={createSample}>
            Registrar muestra
          </Button>
        </div>
      </Card>

      <Card className="self-start">
        <CardTitle action={<span className="text-label text-ink-3">{samples.length}</span>}>Muestras</CardTitle>
        {samples.length === 0 ? (
          <p className="py-3 text-center text-label text-ink-3">Sin muestras.</p>
        ) : (
          <ul className="divide-y divide-subtle">
            {samples.map((s) => (
              <li key={s.id} className="space-y-1 py-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <span className="text-body font-medium">{SAMPLE_TYPE_ES[s.sample_type] ?? s.sample_type}</span>
                    <div className="truncate text-label text-ink-3">
                      {s.animal_tag ? `Caravana ${s.animal_tag}` : s.paddock_name ? s.paddock_name : '—'}
                      {s.lab_name ? ` · ${s.lab_name}` : ''}
                    </div>
                  </div>
                  <span className="shrink-0 rounded-full bg-subtle px-2 py-0.5 text-caption font-medium text-ink-2">{STATUS[s.status] ?? s.status}</span>
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  {(ACTIONS[s.status] ?? []).map(([to, label]) => (
                    <Button key={to} variant="secondary" size="sm" loading={busy} disabled={busy} onClick={() => transition(s, to)}>
                      {label}
                    </Button>
                  ))}
                  <Button variant="secondary" size="sm" disabled={busy} onClick={() => openResults(s)}>
                    Resultados{s.result_count ? ` (${s.result_count}${s.abnormal_count ? `, ${s.abnormal_count}⚠` : ''})` : ''}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="self-start">
        <CardTitle>{selected ? `Resultados · ${SAMPLE_TYPE_ES[selected.sample_type] ?? selected.sample_type}` : 'Resultados'}</CardTitle>
        {!selected ? (
          <p className="py-3 text-center text-label text-ink-3">Elegí una muestra para ver sus resultados.</p>
        ) : (
          <div className="space-y-3">
            {results.length === 0 ? (
              <p className="text-label text-ink-3">Sin resultados cargados.</p>
            ) : (
              <ul className="divide-y divide-subtle">
                {results.map((r) => (
                  <li key={r.id} className="py-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <span className="text-body font-medium">{r.test_code}</span>
                        <span className="ml-2 text-label text-ink-3">
                          {r.result_value ?? '—'}
                          {r.reference_range ? ` (${r.reference_range})` : ''}
                        </span>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {r.is_notifiable && (
                          <span className="rounded-full border border-danger/30 bg-danger/10 px-2 py-0.5 text-caption font-medium text-danger">Denuncia obligatoria</span>
                        )}
                        {r.is_abnormal && <span className="rounded-full border border-danger/30 bg-danger/10 px-2 py-0.5 text-caption font-medium text-danger">Anormal</span>}
                      </div>
                    </div>
                    {r.diagnosis && <div className="text-caption text-ink-3">Diagnóstico: {r.diagnosis}</div>}
                    {r.clinical_case_id ? (
                      // Los casos viven en el panel de Sanidad, no en una ruta propia por caso.
                      <Link href="/sanidad#casos" className="text-caption font-medium text-brand hover:underline">
                        Caso clínico abierto →
                      </Link>
                    ) : (
                      // El resultado anormal SIN caso es el que necesita una persona. Se ofrece la
                      // acción acá, con el animal y el resultado ya cargados: es lo que evita el
                      // camino largo por Sanidad retipeando todo.
                      r.is_abnormal &&
                      selected?.animal_id && (
                        <div className="mt-1 flex items-center gap-1">
                          <Select
                            value={caseDiagnosis[r.id] ?? r.diagnosis_id ?? ''}
                            onChange={(e) => setCaseDiagnosis({ ...caseDiagnosis, [r.id]: e.target.value })}
                            controlSize="sm"
                            aria-label={`Diagnóstico para abrir el caso de ${r.test_code}`}
                          >
                            <option value="">Diagnóstico…</option>
                            {diagnoses.map((d) => (
                              <option key={d.id} value={d.id}>
                                {d.name}
                                {d.is_notifiable ? ' (denuncia obligatoria)' : ''}
                              </option>
                            ))}
                          </Select>
                          <Button
                            size="sm"
                            variant="secondary"
                            loading={busy}
                            disabled={busy || !(caseDiagnosis[r.id] ?? r.diagnosis_id)}
                            onClick={() => openCase(r, caseDiagnosis[r.id] ?? r.diagnosis_id!)}
                          >
                            Abrir caso
                          </Button>
                        </div>
                      )
                    )}
                  </li>
                ))}
              </ul>
            )}
            {veredicto && (
              <p className={`rounded border px-2 py-1.5 text-label ${veredicto.opensCase ? 'border-danger/30 bg-danger/5 text-danger' : 'border-subtle text-ink-3'}`}>
                {veredicto.opensCase ? 'Se abrió un caso clínico. ' : 'No se abrió caso clínico. '}
                {veredicto.explanation}
              </p>
            )}
            {RESULTABLE.includes(selected.status) ? (
              <div className="space-y-2 border-t border-subtle pt-2">
                <div className="flex gap-1">
                  <Input value={testCode} onChange={(e) => setTestCode(e.target.value)} placeholder="Test" aria-label="Código de test" />
                  <Input value={resultValue} onChange={(e) => setResultValue(e.target.value)} placeholder="Valor" aria-label="Valor" />
                </div>
                <div className="flex items-center gap-2">
                  <Input value={refRange} onChange={(e) => setRefRange(e.target.value)} placeholder="Rango ref." aria-label="Rango de referencia" />
                  <label className="flex shrink-0 items-center gap-1 text-label text-ink-2">
                    <input type="checkbox" checked={abnormal} onChange={(e) => setAbnormal(e.target.checked)} /> Anormal
                  </label>
                </div>
                {/* Con diagnóstico, un resultado anormal abre el caso clínico solo. Sin él queda como
                    hallazgo para que lo mire el veterinario: es la diferencia entre «qué es» y «está raro». */}
                {selected.animal_id && (
                  <Select value={diagnosisId} onChange={(e) => setDiagnosisId(e.target.value)} controlSize="sm" aria-label="Diagnóstico (opcional)">
                    <option value="">Sin diagnóstico…</option>
                    {diagnoses.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                        {d.is_notifiable ? ' (denuncia obligatoria)' : ''}
                      </option>
                    ))}
                  </Select>
                )}
                {abnormal && diagnosisId && selected.animal_id && (
                  <p className="text-caption text-ink-3">Al guardar se abrirá un caso clínico con este animal.</p>
                )}
                <Button size="sm" fullWidth loading={busy} disabled={busy || !testCode.trim()} onClick={addResult}>
                  Cargar resultado
                </Button>
              </div>
            ) : (
              <p className="border-t border-subtle pt-2 text-caption text-ink-3">Enviá la muestra al laboratorio para cargar resultados.</p>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
