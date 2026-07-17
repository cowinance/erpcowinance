'use client';

/**
 * Modo manga (doc diseño §12.3): estación de captura rápida en campo.
 * Alto contraste AAA, targets gigantes operables con guantes, feedback auditivo.
 * Flujo de 2 pasos: identificar animal → registrar acción → guardar → siguiente.
 * El modo campo ignora el tema: negro puro + blanco puro + acentos saturados.
 *
 * A-Manga E2: envuelve la captura en una SESIÓN de trabajo (nombre/lote objetivo/inicio,
 * contadores registrados+errores, últimos registros, estado de conexión, resumen al salir).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { API_URL, authHeaders } from '@/lib/api';

interface Animal {
  id: string;
  tag: string;
  name?: string;
  category?: string;
  category_code?: string;
  sex?: string;
  status?: string;
  lot_id?: string | null;
  lot_name?: string | null;
  paddock_name?: string | null;
  last_weight_kg?: number | null;
  last_weighed_at?: string | null;
  days_since_weighing?: number | null;
  adg?: number | null;
  last_body_condition?: number | null;
  expected_due_date?: string | null;
  has_withdrawal?: boolean;
  meat_withdrawal_until?: string | null;
  open_cases?: number;
  case_severity?: string | null;
}

interface SessionRecord {
  key: string;
  tag: string;
  action: string;
  detail: string;
  at: number;
  status: 'saved' | 'pending' | 'error';
}

function beep(freq: number, ms = 120, when = 0) {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = freq;
    gain.gain.value = 0.15;
    osc.start(ctx.currentTime + when / 1000);
    osc.stop(ctx.currentTime + (when + ms) / 1000);
  } catch {
    /* sin audio */
  }
}
const soundOk = () => beep(880, 90);
const soundSaved = () => {
  beep(660, 80);
  beep(990, 90, 100);
};
const soundError = () => {
  beep(220, 160);
  beep(180, 200, 180);
};

const CC_OPTIONS = [2, 2.5, 3, 3.5, 4, 4.5];

function fmtDate(d: string): string {
  return new Date(d).toLocaleDateString('es-AR', { day: '2-digit', month: 'short' });
}
function fmtClock(t: number): string {
  return new Date(t).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
}

/** Alertas rápidas derivadas de la tarjeta (máx 3, accionables). */
function cardAlerts(a: Animal): { text: string; tone: 'danger' | 'warning' }[] {
  const out: { text: string; tone: 'danger' | 'warning' }[] = [];
  if (a.has_withdrawal) out.push({ text: `RETIRO ACTIVO${a.meat_withdrawal_until ? ` hasta ${fmtDate(a.meat_withdrawal_until)}` : ''}`, tone: 'danger' });
  if ((a.open_cases ?? 0) > 0) out.push({ text: `CASO CLÍNICO ABIERTO${a.case_severity === 'severe' ? ' (grave)' : ''}`, tone: 'danger' });
  if (a.sex === 'F' && a.expected_due_date) {
    const days = Math.round((new Date(a.expected_due_date).getTime() - Date.now()) / 86400000);
    if (days <= 21 && days >= -10) out.push({ text: `PARTO PRÓXIMO (${days <= 0 ? 'vencido' : `${days} d`})`, tone: 'warning' });
  }
  if (!a.lot_id) out.push({ text: 'SIN LOTE', tone: 'warning' });
  if (a.days_since_weighing == null || a.days_since_weighing > 90) out.push({ text: a.days_since_weighing == null ? 'SIN PESAJE' : 'SIN PESAJE RECIENTE', tone: 'warning' });
  return out.slice(0, 3);
}

export default function MangaPage() {
  const [phase, setPhase] = useState<'setup' | 'capture' | 'summary'>('setup');
  const [sessionName, setSessionName] = useState('');
  const [targetLot, setTargetLot] = useState<{ id: string; name: string } | null>(null);
  const [lots, setLots] = useState<{ id: string; name: string }[]>([]);
  const [startedAt, setStartedAt] = useState<number>(0);
  const [records, setRecords] = useState<SessionRecord[]>([]);
  const [errors, setErrors] = useState(0);
  const [online, setOnline] = useState(true);

  const [animal, setAnimal] = useState<Animal | null>(null);
  const [tag, setTag] = useState('');
  const [kg, setKg] = useState('');
  const [cc, setCc] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [shake, setShake] = useState(false);
  const tagRef = useRef<HTMLInputElement>(null);
  const kgRef = useRef<HTMLInputElement>(null);

  // Estado de conexión (para el indicador de la barra).
  useEffect(() => {
    const upd = () => setOnline(navigator.onLine);
    upd();
    window.addEventListener('online', upd);
    window.addEventListener('offline', upd);
    return () => {
      window.removeEventListener('online', upd);
      window.removeEventListener('offline', upd);
    };
  }, []);

  // Catálogo de lotes (para el lote objetivo de la sesión).
  useEffect(() => {
    fetch(`${API_URL}/lots`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => setLots(Array.isArray(d) ? d.map((l: any) => ({ id: l.id, name: l.name })) : []))
      .catch(() => setLots([]));
  }, []);

  useEffect(() => {
    if (phase === 'capture') (animal ? kgRef : tagRef).current?.focus();
  }, [animal, phase]);

  const fail = useCallback((msg: string) => {
    setError(msg);
    soundError();
    setShake(true);
    setErrors((e) => e + 1);
    setTimeout(() => setShake(false), 400);
  }, []);

  function startSession() {
    setStartedAt(Date.now());
    setRecords([]);
    setErrors(0);
    setPhase('capture');
  }

  async function lookup() {
    if (!tag.trim()) return;
    setError('');
    try {
      const res = await fetch(`${API_URL}/animals/lookup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ identifier: tag.trim() }),
      });
      if (!res.ok) return fail(`SIN ANIMAL ${tag.trim().toUpperCase()}`);
      setAnimal(await res.json());
      setTag('');
      soundOk();
    } catch {
      fail('SIN CONEXIÓN CON LA API');
    }
  }

  async function save() {
    if (!animal || !kg) return;
    setError('');
    try {
      const res = await fetch(`${API_URL}/animals/${animal.id}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders(), 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({ type: 'weighing', weight_kg: Number(kg), body_condition: cc ?? undefined }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => null);
        return fail(b?.message?.title ?? 'ERROR AL GUARDAR');
      }
      soundSaved();
      setRecords((r) => [
        { key: crypto.randomUUID(), tag: animal.tag, action: 'Pesaje', detail: `${kg} kg${cc ? ` · CC ${cc}` : ''}`, at: Date.now(), status: 'saved' },
        ...r,
      ]);
      setAnimal(null);
      setKg('');
      setCc(null);
    } catch {
      fail('SIN CONEXIÓN CON LA API');
    }
  }

  const saved = records.filter((r) => r.status === 'saved').length;

  // ── Pantalla de inicio de sesión ──
  if (phase === 'setup') {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-7 bg-black px-6 text-white select-none">
        <div className="text-center">
          <div className="text-[13px] font-bold tracking-[0.3em] text-white/40">MODO MANGA</div>
          <div className="mt-2 text-[30px] font-extrabold">Nueva sesión de trabajo</div>
        </div>
        <div className="w-full max-w-md space-y-4">
          <div>
            <label className="mb-1.5 block text-[13px] font-bold tracking-[0.15em] text-white/50 uppercase">Nombre (opcional)</label>
            <input
              value={sessionName}
              onChange={(e) => setSessionName(e.target.value)}
              placeholder="Ej. Pesada recría — mañana"
              className="h-14 w-full rounded-xl border border-white/20 bg-white/[0.04] px-4 text-[20px] outline-none placeholder:text-white/25 focus:border-[#4ade80]"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-[13px] font-bold tracking-[0.15em] text-white/50 uppercase">Lote objetivo (opcional)</label>
            <select
              value={targetLot?.id ?? ''}
              onChange={(e) => setTargetLot(e.target.value ? { id: e.target.value, name: lots.find((l) => l.id === e.target.value)?.name ?? '' } : null)}
              className="h-14 w-full rounded-xl border border-white/20 bg-white/[0.04] px-4 text-[20px] outline-none focus:border-[#4ade80]"
            >
              <option value="">Todos los animales</option>
              {lots.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </div>
          <div>
            <div className="mb-1.5 text-[13px] font-bold tracking-[0.15em] text-white/50 uppercase">Modo</div>
            <div className="h-14 rounded-xl bg-[#4ade80] text-center text-[20px] font-extrabold leading-[56px] text-black">PESAJE</div>
          </div>
        </div>
        <button onClick={startSession} className="h-[72px] w-full max-w-md rounded-xl bg-white text-[24px] font-extrabold text-black">
          EMPEZAR
        </button>
        <Link href="/" className="text-[15px] text-white/40 underline">Cancelar</Link>
      </div>
    );
  }

  // ── Resumen final ──
  if (phase === 'summary') {
    const mins = Math.max(1, Math.round((Date.now() - startedAt) / 60000));
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-black px-6 text-white select-none">
        <div className="text-center">
          <div className="text-[13px] font-bold tracking-[0.3em] text-white/40">RESUMEN DE SESIÓN</div>
          {sessionName && <div className="mt-1 text-[22px] font-bold">{sessionName}</div>}
          <div className="mt-1 text-[15px] text-white/50">
            {targetLot ? `${targetLot.name} · ` : ''}{mins} min · desde {fmtClock(startedAt)}
          </div>
        </div>
        <div className="grid w-full max-w-md grid-cols-2 gap-3">
          <SummaryStat label="Procesados" value={saved} tone="ok" />
          <SummaryStat label="Errores" value={errors} tone={errors ? 'error' : 'muted'} />
          <SummaryStat label="Pesos registrados" value={records.filter((r) => r.action === 'Pesaje').length} tone="muted" />
          <SummaryStat label="Pendientes de sync" value={records.filter((r) => r.status === 'pending').length} tone="muted" />
        </div>
        {records.length > 0 && (
          <div className="w-full max-w-md">
            <div className="mb-2 text-[12px] font-bold tracking-[0.15em] text-white/40 uppercase">Últimos registros</div>
            <div className="max-h-48 space-y-1 overflow-y-auto">
              {records.slice(0, 20).map((r) => (
                <div key={r.key} className="flex items-center justify-between rounded-lg bg-white/[0.04] px-3 py-2 text-[15px]">
                  <span className="font-mono font-bold text-[#4ade80]">{r.tag}</span>
                  <span className="text-white/70">{r.detail}</span>
                  <span className="text-white/40">{fmtClock(r.at)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="flex w-full max-w-md gap-3">
          <button onClick={() => setPhase('setup')} className="h-[64px] flex-1 rounded-xl bg-white/10 text-[18px] font-bold text-white">Nueva sesión</button>
          <Link href="/" className="flex h-[64px] flex-1 items-center justify-center rounded-xl bg-white text-[18px] font-extrabold text-black">Salir</Link>
        </div>
      </div>
    );
  }

  // ── Captura ──
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black text-white select-none">
      {/* Barra superior: sesión + progreso + conexión, siempre visible */}
      <div className="flex h-14 items-center justify-between gap-3 border-b border-white/20 px-5">
        <span className="flex items-center gap-2 text-[13px] font-bold tracking-[0.15em] text-white/60">
          <span className={`inline-block size-2.5 rounded-full ${online ? 'bg-[#4ade80]' : 'bg-[#f87171]'}`} title={online ? 'Conectado' : 'Sin conexión'} />
          {sessionName ? <span className="max-w-[180px] truncate normal-case tracking-normal text-white/80">{sessionName}</span> : 'MODO MANGA'}
        </span>
        <span className="flex items-center gap-4 font-mono text-[18px] font-bold">
          <span className="text-[#4ade80]">{saved} <span className="text-[12px] font-normal text-white/40">reg</span></span>
          <span className={errors ? 'text-[#f87171]' : 'text-white/30'}>{errors} <span className="text-[12px] font-normal text-white/40">err</span></span>
        </span>
        <button onClick={() => setPhase('summary')} className="rounded border border-white/30 px-3 py-1.5 text-[13px] text-white/70 hover:text-white">
          Salir
        </button>
      </div>

      <div className={`flex flex-1 flex-col items-center justify-center gap-6 overflow-y-auto px-6 py-6 ${shake ? 'animate-[shake_0.4s]' : ''}`}>
        {!animal ? (
          /* Paso 1: identificar el animal */
          <>
            <div className="text-[15px] font-bold tracking-[0.15em] text-white/50 uppercase">Caravana</div>
            <input
              ref={tagRef}
              value={tag}
              onChange={(e) => setTag(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && lookup()}
              inputMode="numeric"
              autoFocus
              className="w-72 border-b-4 border-white/40 bg-transparent text-center font-mono text-[64px] leading-none font-bold outline-none focus:border-[#4ade80]"
              aria-label="Caravana del animal"
            />
            {error && <div className="text-[22px] font-bold text-[#f87171]">{error}</div>}
            <button
              onClick={lookup}
              disabled={!tag.trim()}
              className="h-[72px] w-full max-w-md rounded-xl bg-white text-[24px] font-extrabold text-black disabled:opacity-30"
            >
              BUSCAR
            </button>
            {records.length > 0 && (
              <div className="w-full max-w-md">
                <div className="mb-2 text-center text-[12px] font-bold tracking-[0.15em] text-white/40 uppercase">Últimos registros</div>
                <div className="space-y-1">
                  {records.slice(0, 4).map((r) => (
                    <div key={r.key} className="flex items-center justify-between rounded-lg bg-white/[0.04] px-3 py-2 text-[15px]">
                      <span className="font-mono font-bold text-[#4ade80]">{r.tag}</span>
                      <span className="text-white/60">{r.action} · {r.detail}</span>
                      <span className="text-white/35">{fmtClock(r.at)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          /* Paso 2: capturar peso y condición */
          <>
            <AnimalCard animal={animal} />
            {(() => {
              const alerts = cardAlerts(animal);
              return alerts.length ? (
                <div className="flex w-full max-w-2xl flex-wrap justify-center gap-2">
                  {alerts.map((al) => (
                    <span key={al.text} className={`rounded-lg px-3 py-2 text-[15px] font-bold ${al.tone === 'danger' ? 'bg-[#f87171] text-black' : 'bg-[#facc15] text-black'}`}>
                      {al.text}
                    </span>
                  ))}
                </div>
              ) : null;
            })()}

            <div className="flex items-end gap-3">
              <input
                ref={kgRef}
                value={kg}
                onChange={(e) => setKg(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && save()}
                inputMode="decimal"
                placeholder="0"
                className="w-56 border-b-4 border-white/40 bg-transparent text-center font-mono text-[56px] leading-none font-bold text-white outline-none placeholder:text-white/20 focus:border-[#4ade80]"
                aria-label="Peso en kilogramos"
              />
              <span className="pb-2 text-[24px] font-bold text-white/50">kg</span>
            </div>

            <div className="w-full max-w-md">
              <div className="mb-2 text-center text-[13px] font-bold tracking-[0.15em] text-white/50 uppercase">Condición corporal</div>
              <div className="grid grid-cols-6 gap-2">
                {CC_OPTIONS.map((v) => (
                  <button key={v} onClick={() => setCc(cc === v ? null : v)} className={`h-14 rounded-lg text-[20px] font-bold ${cc === v ? 'bg-[#4ade80] text-black' : 'bg-white/10 text-white/80'}`}>
                    {v}
                  </button>
                ))}
              </div>
            </div>

            {error && <div className="text-[20px] font-bold text-[#f87171]">{error}</div>}

            <button onClick={save} disabled={!kg} className="h-[72px] w-full max-w-md rounded-xl bg-[#4ade80] text-[24px] font-extrabold text-black disabled:opacity-30">
              GUARDAR Y SIGUIENTE
            </button>
            <button onClick={() => (setAnimal(null), setKg(''), setCc(null), setError(''))} className="text-[15px] text-white/50 underline">
              Cambiar animal
            </button>
          </>
        )}
      </div>

      <style jsx global>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-6px); }
          75% { transform: translateX(6px); }
        }
      `}</style>
    </div>
  );
}

function SummaryStat({ label, value, tone }: { label: string; value: number; tone: 'ok' | 'error' | 'muted' }) {
  const color = tone === 'ok' ? 'text-[#4ade80]' : tone === 'error' ? 'text-[#f87171]' : 'text-white';
  return (
    <div className="rounded-xl border border-white/15 bg-white/[0.04] px-4 py-3">
      <div className={`font-mono text-[36px] font-bold ${color}`}>{value}</div>
      <div className="text-[13px] text-white/50">{label}</div>
    </div>
  );
}

/** Tarjeta robusta del animal escaneado (A-Manga E1): grande, legible, no saturada. */
function AnimalCard({ animal }: { animal: Animal }) {
  const facts: { label: string; value: string; strong?: boolean }[] = [];
  if (animal.last_weight_kg != null)
    facts.push({
      label: 'Último peso',
      value: `${Math.round(animal.last_weight_kg)} kg${animal.days_since_weighing != null ? ` · hace ${animal.days_since_weighing} d` : ''}`,
      strong: true,
    });
  if (animal.adg != null) facts.push({ label: 'GDP', value: `${animal.adg.toFixed(2)} kg/d` });
  if (animal.last_body_condition != null) facts.push({ label: 'Cond. corporal', value: String(animal.last_body_condition) });
  facts.push({ label: 'Lote', value: animal.lot_name ?? 'sin lote' });
  if (animal.paddock_name) facts.push({ label: 'Potrero', value: animal.paddock_name });
  if (animal.sex === 'F' && animal.expected_due_date) facts.push({ label: 'Preñada', value: `parto ~${fmtDate(animal.expected_due_date)}` });

  return (
    <div className="w-full max-w-2xl rounded-2xl border border-white/15 bg-white/[0.04] px-6 py-5">
      <div className="flex items-baseline justify-between gap-4">
        <div className="min-w-0">
          <div className="font-mono text-[56px] leading-none font-bold text-[#4ade80]">{animal.tag}</div>
          <div className="mt-1.5 truncate text-[18px] text-white/70">
            {animal.name ? `${animal.name} · ` : ''}
            {animal.category}
            {animal.sex ? ` · ${animal.sex === 'F' ? 'Hembra' : 'Macho'}` : ''}
          </div>
        </div>
        {animal.status && animal.status !== 'active' && (
          <span className="shrink-0 rounded-lg bg-[#f87171] px-3 py-1.5 text-[14px] font-bold text-black uppercase">{animal.status}</span>
        )}
      </div>
      <div className="mt-4 grid grid-cols-3 gap-x-4 gap-y-3 max-sm:grid-cols-2">
        {facts.map((f) => (
          <div key={f.label}>
            <div className="text-[12px] font-bold tracking-[0.1em] text-white/40 uppercase">{f.label}</div>
            <div className={`mt-0.5 font-mono ${f.strong ? 'text-[24px] font-bold text-white' : 'text-[19px] text-white/85'}`}>{f.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
