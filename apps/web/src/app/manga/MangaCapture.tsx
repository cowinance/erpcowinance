'use client';

/**
 * Captura por MODO en el modo manga (A-Manga E4). Cada modo mantiene la misma lógica
 * (escanear → resumen → dato mínimo → guardar → siguiente) y REUSA su servicio central,
 * sin inserts manuales:
 *  - Revisión / Nota → POST /animals/:id/events (timeline).
 *  - Tratamiento → POST /treatments (TreatmentService, retiro derivado, valida activo).
 *  - Vacunación → POST /vaccinations (VaccinationService, idempotente).
 *  - Movimiento → POST /movements (servicio central; NUNCA update directo de current_lot_id).
 *  - Reproducción → POST /animals/:id/heats|services + /pregnancy-diagnoses.
 * El modo Pesaje vive en page.tsx (con validateWeighing). Idempotency-Key en los guardados.
 */
import { useEffect, useState } from 'react';
import { API_URL, authHeaders, apiErrorTitle } from '@/lib/api';
import { fetchMatingCandidates, type MatingCandidate } from '@/lib/mating';

export interface MangaAnimal {
  id: string;
  tag: string;
  sex?: string;
  status?: string;
  lot_id?: string | null;
  lot_name?: string | null;
  has_withdrawal?: boolean;
  open_cases?: number;
  expected_due_date?: string | null;
}

export type MangaMode = 'Pesaje' | 'Revisión' | 'Nota' | 'Tratamiento' | 'Vacunación' | 'Movimiento' | 'Reproducción';

interface Catalogs {
  products: any[];
  lots: { id: string; name: string }[];
  bulls: { id: string; tag?: string; name?: string }[];
}

const NOTE_TEMPLATES = ['cojea', 'flaco', 'revisar ojo', 'revisar ubre', 'agresivo', 'sin novedad'];

const inputCls =
  'w-full rounded-xl border border-white/20 bg-white/[0.04] px-4 text-[22px] outline-none placeholder:text-white/25 focus:border-[#4ade80]';
const bigBtn = 'h-[68px] w-full max-w-md rounded-xl text-[22px] font-extrabold disabled:opacity-30';

export function MangaCapture({
  animal,
  mode,
  catalogs,
  onSaved,
  onError,
  onCancel,
}: {
  animal: MangaAnimal;
  mode: MangaMode;
  catalogs: Catalogs;
  onSaved: (rec: { action: string; detail: string }) => void;
  onError: (msg: string) => void;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);

  async function post(url: string, body: any, idem = true): Promise<any> {
    setBusy(true);
    try {
      const res = await fetch(`${API_URL}${url}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders(), ...(idem ? { 'Idempotency-Key': crypto.randomUUID() } : {}) },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(apiErrorTitle(json, `Error ${res.status}`));
      return json;
    } catch (e: any) {
      onError((e.message ?? 'ERROR AL GUARDAR').toUpperCase());
      throw e;
    } finally {
      setBusy(false);
    }
  }

  if (mode === 'Revisión') return <ReviewForm animal={animal} busy={busy} post={post} onSaved={onSaved} onCancel={onCancel} />;
  if (mode === 'Nota') return <NoteForm animal={animal} busy={busy} post={post} onSaved={onSaved} onCancel={onCancel} />;
  if (mode === 'Tratamiento') return <TreatForm animal={animal} catalogs={catalogs} busy={busy} post={post} onSaved={onSaved} onCancel={onCancel} />;
  if (mode === 'Vacunación') return <VaccineForm animal={animal} catalogs={catalogs} busy={busy} post={post} onSaved={onSaved} onCancel={onCancel} />;
  if (mode === 'Movimiento') return <MoveForm animal={animal} catalogs={catalogs} busy={busy} post={post} onSaved={onSaved} onCancel={onCancel} />;
  if (mode === 'Reproducción') return <ReproForm animal={animal} catalogs={catalogs} busy={busy} post={post} onSaved={onSaved} onCancel={onCancel} />;
  return null;
}

function CancelLink({ onCancel }: { onCancel: () => void }) {
  return (
    <button onClick={onCancel} className="text-[15px] text-white/50 underline">Cambiar animal</button>
  );
}

function ReviewForm({ animal, busy, post, onSaved, onCancel }: any) {
  const [note, setNote] = useState('');
  const [flag, setFlag] = useState(false);
  async function save() {
    const text = `${flag ? '⚠ ' : ''}Revisado${note.trim() ? ` · ${note.trim()}` : ''}`;
    await post(`/animals/${animal.id}/events`, { type: 'note', text });
    onSaved({ action: 'Revisión', detail: flag ? '⚠ revisado' : 'revisado' });
  }
  return (
    <>
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Nota corta (opcional)" className={inputCls + ' max-w-md h-14'} />
      <button onClick={() => setFlag((f) => !f)} className={`h-12 w-full max-w-md rounded-xl text-[18px] font-bold ${flag ? 'bg-[#facc15] text-black' : 'bg-white/10 text-white/80'}`}>
        {flag ? '⚠ ALERTA MARCADA' : 'Marcar alerta'}
      </button>
      <button onClick={save} disabled={busy} className={`${bigBtn} bg-[#4ade80] text-black`}>REVISADO ✓ Y SIGUIENTE</button>
      <CancelLink onCancel={onCancel} />
    </>
  );
}

function NoteForm({ animal, busy, post, onSaved, onCancel }: any) {
  const [note, setNote] = useState('');
  async function save() {
    if (!note.trim()) return;
    await post(`/animals/${animal.id}/events`, { type: 'note', text: note.trim() });
    onSaved({ action: 'Nota', detail: note.trim().slice(0, 40) });
  }
  return (
    <>
      <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="Escribí una nota…" className={inputCls + ' max-w-xl resize-none py-3 text-[24px]'} autoFocus />
      <div className="flex w-full max-w-xl flex-wrap justify-center gap-2">
        {NOTE_TEMPLATES.map((t) => (
          <button key={t} onClick={() => setNote((n) => (n.trim() ? `${n.trim()} · ${t}` : t))} className="h-11 rounded-full bg-white/10 px-4 text-[17px] font-bold text-white/85">
            {t}
          </button>
        ))}
      </div>
      <button onClick={save} disabled={busy || !note.trim()} className={`${bigBtn} bg-[#4ade80] text-black`}>GUARDAR NOTA</button>
      <CancelLink onCancel={onCancel} />
    </>
  );
}

function TreatForm({ animal, catalogs, busy, post, onSaved, onCancel }: any) {
  const products = (catalogs.products ?? []).filter((p: any) => p.type !== 'vaccine');
  const [productId, setProductId] = useState('');
  const [dose, setDose] = useState('');
  const [route, setRoute] = useState('');
  const [notes, setNotes] = useState('');
  const product = products.find((p: any) => p.id === productId);
  const withdrawalDays = product?.withdrawal_meat_days ?? null;

  async function save() {
    if (!productId) return;
    await post(`/treatments`, { animal_id: animal.id, product_id: productId, dose: dose ? Number(dose) : undefined, route: route || undefined, notes: notes || undefined });
    onSaved({ action: 'Tratamiento', detail: product?.name ?? 'tratamiento' });
  }
  return (
    <>
      {animal.status !== 'active' && <Warn text="Animal NO activo — el tratamiento será rechazado" />}
      {(animal.open_cases ?? 0) > 0 && <Warn text="Ya tiene un caso clínico abierto" />}
      <select value={productId} onChange={(e) => { setProductId(e.target.value); const p = products.find((x: any) => x.id === e.target.value); if (p?.default_dose) setDose(String(p.default_dose)); }} className={inputCls + ' max-w-md h-14'}>
        <option value="">— Producto —</option>
        {products.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <div className="grid w-full max-w-md grid-cols-2 gap-3">
        <input value={dose} onChange={(e) => setDose(e.target.value)} inputMode="decimal" placeholder="Dosis" className={inputCls + ' h-14'} />
        <select value={route} onChange={(e) => setRoute(e.target.value)} className={inputCls + ' h-14'}>
          <option value="">Vía</option>
          {['im', 'sc', 'iv', 'oral', 'topical', 'intramammary'].map((r) => <option key={r} value={r}>{r.toUpperCase()}</option>)}
        </select>
      </div>
      <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notas (opcional)" className={inputCls + ' max-w-md h-12 text-[18px]'} />
      {withdrawalDays != null && <div className="text-[16px] text-white/60">Retiro carne: <b className="text-white">{withdrawalDays} días</b></div>}
      <button onClick={save} disabled={busy || !productId} className={`${bigBtn} bg-[#4ade80] text-black`}>GUARDAR TRATAMIENTO</button>
      <CancelLink onCancel={onCancel} />
    </>
  );
}

function VaccineForm({ animal, catalogs, busy, post, onSaved, onCancel }: any) {
  const products = (catalogs.products ?? []).filter((p: any) => p.type === 'vaccine');
  const [productId, setProductId] = useState('');
  const [dose, setDose] = useState('');
  const [batch, setBatch] = useState('');
  const [nextDays, setNextDays] = useState('');
  const product = products.find((p: any) => p.id === productId);

  async function save() {
    if (!productId) return;
    await post(`/vaccinations`, { animal_id: animal.id, product_id: productId, dose: dose ? Number(dose) : undefined, batch_number: batch || undefined, next_due_days: nextDays ? Number(nextDays) : undefined });
    onSaved({ action: 'Vacunación', detail: product?.name ?? 'vacuna' });
  }
  return (
    <>
      <select value={productId} onChange={(e) => { setProductId(e.target.value); const p = products.find((x: any) => x.id === e.target.value); if (p?.default_dose) setDose(String(p.default_dose)); }} className={inputCls + ' max-w-md h-14'}>
        <option value="">— Vacuna —</option>
        {products.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <div className="grid w-full max-w-md grid-cols-2 gap-3">
        <input value={dose} onChange={(e) => setDose(e.target.value)} inputMode="decimal" placeholder="Dosis" className={inputCls + ' h-14'} />
        <input value={batch} onChange={(e) => setBatch(e.target.value)} placeholder="Lote frasco" className={inputCls + ' h-14'} />
      </div>
      <input value={nextDays} onChange={(e) => setNextDays(e.target.value)} inputMode="numeric" placeholder="Próximo refuerzo (días, opcional)" className={inputCls + ' max-w-md h-12 text-[18px]'} />
      <button onClick={save} disabled={busy || !productId} className={`${bigBtn} bg-[#4ade80] text-black`}>GUARDAR VACUNA</button>
      <CancelLink onCancel={onCancel} />
    </>
  );
}

function MoveForm({ animal, catalogs, busy, post, onSaved, onCancel }: any) {
  const [dest, setDest] = useState('');
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const hasAlerts = animal.has_withdrawal || (animal.open_cases ?? 0) > 0;

  async function save() {
    if (!dest) return;
    if (hasAlerts && !confirmed) { setConfirmed(true); return; }
    const lotId = dest === 'clear' ? null : dest;
    const r = await post(`/movements`, { animal_ids: [animal.id], lot_id: lotId, reason: reason || undefined });
    const destName = dest === 'clear' ? 'sin lote' : catalogs.lots.find((l: any) => l.id === dest)?.name ?? 'lote';
    if ((r?.moved ?? 1) === 0) return onSaved({ action: 'Movimiento', detail: `ya en ${destName}` });
    onSaved({ action: 'Movimiento', detail: `→ ${destName}` });
  }
  return (
    <>
      <div className="text-[17px] text-white/60">Actual: <b className="text-white">{animal.lot_name ?? 'sin lote'}</b></div>
      <select value={dest} onChange={(e) => { setDest(e.target.value); setConfirmed(false); }} className={inputCls + ' max-w-md h-14'}>
        <option value="">— Lote destino —</option>
        {catalogs.lots.filter((l: any) => l.id !== animal.lot_id).map((l: any) => <option key={l.id} value={l.id}>{l.name}</option>)}
        <option value="clear">Sacar del lote</option>
      </select>
      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motivo (opcional)" className={inputCls + ' max-w-md h-12 text-[18px]'} />
      {hasAlerts && !confirmed && <Warn text="Este animal tiene alertas — revisá antes de mover" />}
      <button onClick={save} disabled={busy || !dest} className={`${bigBtn} ${hasAlerts && !confirmed ? 'bg-[#facc15]' : 'bg-[#4ade80]'} text-black`}>
        {hasAlerts && !confirmed ? 'CONFIRMAR Y MOVER' : 'MOVER Y SIGUIENTE'}
      </button>
      <CancelLink onCancel={onCancel} />
    </>
  );
}

/**
 * Los toros ordenados por cuán poco emparentados están con la vaca; los que no convienen, al final.
 *
 * Sin el dato (sin señal, o mientras carga) se devuelve el orden original: el selector tiene que
 * funcionar igual, con el animal ya encerrado.
 */
function ordenarPorParentesco(bulls: any[], parentesco: Map<string, MatingCandidate> | null): any[] {
  if (!parentesco) return bulls;
  return [...bulls].sort((a, b) => (parentesco.get(a.id)?.f ?? 0) - (parentesco.get(b.id)?.f ?? 0));
}

function ReproForm({ animal, catalogs, busy, post, onSaved, onCancel }: any) {
  const [action, setAction] = useState<'celo' | 'servicio' | 'diagnostico' | null>(null);
  const [method, setMethod] = useState('ai');
  const [sireId, setSireId] = useState('');
  const [result, setResult] = useState('pregnant');
  const [parentesco, setParentesco] = useState<Map<string, MatingCandidate> | null>(null);

  // El parentesco de cada toro con ESTA vaca, en una sola consulta y solo cuando se elige
  // «servicio»: en la manga el animal está encerrado esperando, y no se paga una consulta que
  // quizás no se use. Si falla —en el corral puede no haber señal— el selector queda como estaba:
  // una pantalla de captura no se rompe porque falló un dato de apoyo.
  useEffect(() => {
    if (action !== 'servicio' || animal.sex !== 'F' || parentesco) return;
    void fetchMatingCandidates(animal.id).then((c) => {
      if (c) setParentesco(new Map(c.map((x) => [x.sire_id, x])));
    });
  }, [action, animal.id, animal.sex, parentesco]);

  const elegido = sireId ? parentesco?.get(sireId) : undefined;

  if (animal.sex !== 'F') {
    return (
      <>
        <div className="max-w-md text-center text-[18px] text-white/60">Este animal es macho. Registrá el servicio desde la hembra eligiéndolo como toro.</div>
        <CancelLink onCancel={onCancel} />
      </>
    );
  }

  async function run() {
    if (action === 'celo') {
      // Sin fecha: la pone el servidor, que la calcula en la zona de la finca. Mandarla desde acá
      // era peor de dos maneras: se computaba en UTC (después de las 20:00 quedaba el día
      // siguiente) y además DEGRADABA el instante real del celo a una fecha suelta.
      await post(`/animals/${animal.id}/heats`, {});
      onSaved({ action: 'Celo', detail: 'registrado' });
    } else if (action === 'servicio') {
      await post(`/animals/${animal.id}/services`, { method, sire_id: sireId || undefined });
      onSaved({ action: 'Servicio', detail: method === 'ai' ? 'IA' : 'monta' });
    } else if (action === 'diagnostico') {
      // Idem: la fecha del diagnóstico la pone el servidor en hora de finca.
      await post(`/pregnancy-diagnoses`, { animal_id: animal.id, result, method: 'palpation' }, false);
      onSaved({ action: 'Diagnóstico', detail: result === 'pregnant' ? 'preñada' : result === 'empty' ? 'vacía' : 'dudosa' });
    }
  }

  return (
    <>
      {animal.expected_due_date && <div className="text-[17px] text-white/60">Preñada · parto ~{new Date(animal.expected_due_date).toLocaleDateString('es-AR', { day: '2-digit', month: 'short' })}</div>}
      <div className="grid w-full max-w-md grid-cols-3 gap-2">
        {(['celo', 'servicio', 'diagnostico'] as const).map((a) => (
          <button key={a} onClick={() => setAction(a)} className={`h-14 rounded-xl text-[17px] font-bold capitalize ${action === a ? 'bg-[#4ade80] text-black' : 'bg-white/10 text-white/80'}`}>
            {a === 'diagnostico' ? 'Diag.' : a}
          </button>
        ))}
      </div>

      {action === 'servicio' && (
        <div className="w-full max-w-md space-y-2">
          <div className="flex gap-2">
            {[['ai', 'IA'], ['natural', 'Monta']].map(([v, l]) => (
              <button key={v} onClick={() => setMethod(v)} className={`h-12 flex-1 rounded-lg text-[17px] font-bold ${method === v ? 'bg-[#4ade80] text-black' : 'bg-white/10 text-white/80'}`}>{l}</button>
            ))}
          </div>
          {method === 'natural' && (
            <>
            <select value={sireId} onChange={(e) => setSireId(e.target.value)} className={inputCls + ' h-12 text-[18px]'}>
              <option value="">Sin toro</option>
              {/* Los que no convienen van al FINAL y con el porcentaje a la vista. No se esconden:
                  el productor tiene ese toro en el potrero y necesita entender por qué no. */}
              {ordenarPorParentesco(catalogs.bulls, parentesco).map((b: any) => {
                const p = parentesco?.get(b.id);
                const etiqueta = `${b.tag ?? b.id.slice(0, 6)}${b.name ? ` — ${b.name}` : ''}`;
                return (
                  <option key={b.id} value={b.id}>
                    {etiqueta}
                    {p ? (p.blocks ? `  ⚠ ${p.f_pct}% parentesco` : p.f_pct > 0 ? `  · ${p.f_pct}%` : '') : ''}
                  </option>
                );
              })}
            </select>
            {elegido?.blocks && (
              <div className="rounded-lg bg-[#ef4444]/15 px-3 py-2 text-[17px] font-bold text-[#f87171]">
                Parentesco {elegido.f_pct}% — el servicio se va a rechazar por consanguinidad.
              </div>
            )}
            </>
          )}
        </div>
      )}
      {action === 'diagnostico' && (
        <select value={result} onChange={(e) => setResult(e.target.value)} className={inputCls + ' max-w-md h-12 text-[18px]'}>
          <option value="pregnant">Preñada</option>
          <option value="empty">Vacía</option>
          <option value="doubtful">Dudosa</option>
        </select>
      )}

      <button onClick={run} disabled={busy || !action} className={`${bigBtn} bg-[#4ade80] text-black`}>
        {action ? `GUARDAR ${action === 'diagnostico' ? 'DIAGNÓSTICO' : action.toUpperCase()}` : 'ELEGÍ UNA ACCIÓN'}
      </button>
      <CancelLink onCancel={onCancel} />
    </>
  );
}

function Warn({ text }: { text: string }) {
  return <div className="w-full max-w-md rounded-lg bg-[#facc15]/15 px-4 py-2 text-center text-[16px] font-bold text-[#facc15]">⚠ {text}</div>;
}
