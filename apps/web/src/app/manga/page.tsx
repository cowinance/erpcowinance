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
import { mangaCardAlerts, validateWeighing } from '@cowinance/domain';
import { API_URL, authHeaders } from '@/lib/api';
import { downloadCsv } from '@/lib/csv';
import { MangaCapture, type MangaMode } from './MangaCapture';

const MODES: MangaMode[] = ['Pesaje', 'Revisión', 'Nota', 'Tratamiento', 'Vacunación', 'Movimiento', 'Reproducción'];

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
  undoId?: string; // weighing_id → permite deshacer un pesaje
  retry?: { url: string; body: any }; // guardado offline pendiente de reenvío
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
/** Vibración háptica (móvil web) — no-op en desktop. */
const vibrate = (pattern: number | number[]) => {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* sin vibración */
  }
};
/** Anti-rebote del lector: ignora el MISMO identificador re-escaneado dentro de esta ventana (ms). */
const SCAN_DEBOUNCE_MS = 1500;

const CC_OPTIONS = [2, 2.5, 3, 3.5, 4, 4.5];

function fmtDate(d: string): string {
  return new Date(d).toLocaleDateString('es-AR', { day: '2-digit', month: 'short' });
}
function fmtClock(t: number): string {
  return new Date(t).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Alertas de la tarjeta. La REGLA vive en `@cowinance/domain` y la comparten la manga de la web y
 * la del móvil: cuando cada canal decidía por su cuenta, el móvil no mostraba retiro activo ni caso
 * clínico abierto — las dos que impiden mandar el animal a faena o pasarlo de largo estando enfermo.
 * Acá solo se traduce la forma del DTO de `herd.lookup` a la entrada del dominio.
 */
function cardAlerts(a: Animal) {
  return mangaCardAlerts({
    meatWithdrawalUntil: a.meat_withdrawal_until,
    // `has_withdrawal` es true también cuando solo hay retiro de LECHE, que no trae fecha en el
    // DTO: se pasa la de carne como marca para que la alerta igual aparezca.
    milkWithdrawalUntil: a.has_withdrawal && !a.meat_withdrawal_until ? new Date().toISOString() : null,
    openCases: a.open_cases,
    caseSeverity: a.case_severity,
    sex: a.sex,
    expectedDueDate: a.expected_due_date,
    lotId: a.lot_id,
    daysSinceWeighing: a.days_since_weighing,
  });
}

export default function MangaPage() {
  const [phase, setPhase] = useState<'setup' | 'capture' | 'summary'>('setup');
  const [mode, setMode] = useState<MangaMode>('Pesaje');
  const [sessionName, setSessionName] = useState('');
  const [targetLot, setTargetLot] = useState<{ id: string; name: string } | null>(null);
  const [lots, setLots] = useState<{ id: string; name: string }[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [bulls, setBulls] = useState<any[]>([]);
  const [startedAt, setStartedAt] = useState<number>(0);
  const [records, setRecords] = useState<SessionRecord[]>([]);
  const [errors, setErrors] = useState(0);
  const [online, setOnline] = useState(true);

  const [animal, setAnimal] = useState<Animal | null>(null);
  const [animalTasks, setAnimalTasks] = useState<any[]>([]);
  const [tag, setTag] = useState('');
  const [kg, setKg] = useState('');
  const [cc, setCc] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [warn, setWarn] = useState<string | null>(null);
  const [confirmMsg, setConfirmMsg] = useState<string | null>(null);
  const [shake, setShake] = useState(false);
  const [saving, setSaving] = useState(false);
  const tagRef = useRef<HTMLInputElement>(null);
  const kgRef = useRef<HTMLInputElement>(null);
  const lastScanRef = useRef<{ v: string; at: number }>({ v: '', at: 0 });
  const lookingRef = useRef(false);

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

  // Catálogos: lotes (lote objetivo + modo Movimiento), vademécum (Tratamiento/Vacunación), toros (Servicio).
  useEffect(() => {
    fetch(`${API_URL}/lots`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => setLots(Array.isArray(d) ? d.map((l: any) => ({ id: l.id, name: l.name })) : []))
      .catch(() => setLots([]));
    fetch(`${API_URL}/products-veterinary`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => setProducts(Array.isArray(d) ? d : []))
      .catch(() => setProducts([]));
    fetch(`${API_URL}/animals?category=toro&limit=100`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => setBulls(d?.data ?? []))
      .catch(() => setBulls([]));
  }, []);

  useEffect(() => {
    if (phase === 'capture') (animal ? kgRef : tagRef).current?.focus();
  }, [animal, phase]);

  const fail = useCallback((msg: string) => {
    setError(msg);
    soundError();
    vibrate([80, 60, 80]);
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
    const id = tag.trim();
    if (!id) return;
    // Anti-rebote del lector: el MISMO identificador re-escaneado enseguida (doble lectura por
    // rebote del RFID/scanner) se ignora sin error. Guard de concurrencia por si dispara 2 veces.
    const now = Date.now();
    if (lookingRef.current) return;
    if (lastScanRef.current.v === id.toUpperCase() && now - lastScanRef.current.at < SCAN_DEBOUNCE_MS) {
      setTag('');
      return;
    }
    lastScanRef.current = { v: id.toUpperCase(), at: now };
    lookingRef.current = true;
    setError('');
    try {
      const res = await fetch(`${API_URL}/animals/lookup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ identifier: id }),
      });
      if (!res.ok) return fail(`SIN ANIMAL ${id.toUpperCase()}`);
      const found = await res.json();
      setAnimal(found);
      setTag('');
      soundOk();
      // Integración Tareas (E6): traer las tareas PENDIENTES del animal escaneado.
      setAnimalTasks([]);
      fetch(`${API_URL}/tasks/board?related_type=animal&related_id=${found.id}&status=open`, { headers: authHeaders() })
        .then((r) => r.json())
        .then((d) => setAnimalTasks(Array.isArray(d) ? d : []))
        .catch(() => setAnimalTasks([]));
      vibrate(40);
    } catch {
      fail('SIN CONEXIÓN CON LA API');
    } finally {
      lookingRef.current = false;
    }
  }

  async function save() {
    if (!animal || !kg || saving) return;
    setError('');
    // Validación fuerte (regla única de dominio): errores duros bloquean; advertencias informan;
    // cambio extremo vs último peso exige una segunda confirmación antes de enviar.
    const v = validateWeighing({
      weightKg: Number(kg),
      lastWeightKg: animal.last_weight_kg ?? null,
      daysSinceLast: animal.days_since_weighing ?? null,
    });
    if (!v.ok) {
      setConfirmMsg(null);
      return fail(v.error!.message.toUpperCase());
    }
    setWarn(v.warnings.length ? v.warnings.map((w) => w.message).join(' · ') : null);
    if (v.requiresConfirm && confirmMsg !== v.confirm!.message) {
      setConfirmMsg(v.confirm!.message);
      soundError();
      return; // esperar confirmación (segundo GUARDAR)
    }
    setConfirmMsg(null);
    setSaving(true);
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
      const j = await res.json().catch(() => ({}));
      soundSaved();
      vibrate(60);
      setRecords((r) => [
        { key: crypto.randomUUID(), tag: animal.tag, action: 'Pesaje', detail: `${kg} kg${cc ? ` · CC ${cc}` : ''}`, at: Date.now(), status: 'saved', undoId: j?.weighing_id },
        ...r,
      ]);
      setAnimal(null);
      setKg('');
      setCc(null);
      setWarn(null);
      setConfirmMsg(null);
    } catch {
      // Offline: no se pierde el dato — queda PENDIENTE y se reenvía al reconectar.
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        soundError();
        vibrate([80, 60, 80]);
        setRecords((r) => [
          { key: crypto.randomUUID(), tag: animal.tag, action: 'Pesaje', detail: `${kg} kg${cc ? ` · CC ${cc}` : ''}`, at: Date.now(), status: 'pending', retry: { url: `/animals/${animal.id}/events`, body: { type: 'weighing', weight_kg: Number(kg), body_condition: cc ?? undefined } } },
          ...r,
        ]);
        setAnimal(null);
        setKg('');
        setCc(null);
        setWarn(null);
        setConfirmMsg(null);
      } else {
        fail('SIN CONEXIÓN CON LA API');
      }
    } finally {
      setSaving(false);
    }
  }

  // Reenvía los registros pendientes (offline) cuando vuelve la conexión.
  const flushPending = useCallback(() => {
    setRecords((prev) => {
      prev.filter((r) => r.status === 'pending' && r.retry).forEach(async (r) => {
        try {
          const res = await fetch(`${API_URL}${r.retry!.url}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeaders(), 'Idempotency-Key': crypto.randomUUID() },
            body: JSON.stringify(r.retry!.body),
          });
          if (res.ok) {
            const j = await res.json().catch(() => ({}));
            setRecords((rs) => rs.map((x) => (x.key === r.key ? { ...x, status: 'saved', retry: undefined, undoId: j?.weighing_id } : x)));
          }
        } catch {
          /* sigue pendiente */
        }
      });
      return prev;
    });
  }, []);

  useEffect(() => {
    if (online) flushPending();
  }, [online, flushPending]);

  // Deshace el último pesaje guardado (soft-delete seguro en el servidor).
  async function undoLast() {
    const last = records.find((r) => r.status === 'saved' && r.action === 'Pesaje' && r.undoId);
    if (!last) return;
    try {
      const res = await fetch(`${API_URL}/weighings/${last.undoId}`, { method: 'DELETE', headers: authHeaders() });
      if (!res.ok) return fail('NO SE PUDO DESHACER');
      setRecords((r) => r.filter((x) => x.key !== last.key));
      soundOk();
      vibrate(40);
    } catch {
      fail('SIN CONEXIÓN CON LA API');
    }
  }

  const saved = records.filter((r) => r.status === 'saved').length;
  const pending = records.filter((r) => r.status === 'pending').length;
  const canUndo = records.length > 0 && records[0].status === 'saved' && records[0].action === 'Pesaje' && !!records[0].undoId;

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
            <div className="grid grid-cols-3 gap-2 max-sm:grid-cols-2">
              {MODES.map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`h-12 rounded-xl text-[16px] font-bold ${mode === m ? 'bg-[#4ade80] text-black' : 'bg-white/10 text-white/80'}`}
                >
                  {m}
                </button>
              ))}
            </div>
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
          <SummaryStat label="Pendientes de sync" value={pending} tone={pending ? 'error' : 'muted'} />
          <SummaryStat label="Animales únicos" value={new Set(records.map((r) => r.tag)).size} tone="muted" />
        </div>

        {(() => {
          const byAction = records.reduce<Record<string, number>>((acc, r) => ((acc[r.action] = (acc[r.action] ?? 0) + 1), acc), {});
          const entries = Object.entries(byAction);
          return entries.length ? (
            <div className="flex w-full max-w-md flex-wrap justify-center gap-2">
              {entries.map(([a, n]) => (
                <span key={a} className="rounded-full bg-white/[0.06] px-3 py-1.5 text-[15px] text-white/80">{a}: <b className="text-white">{n}</b></span>
              ))}
            </div>
          ) : null;
        })()}

        {records.length > 0 && (
          <div className="w-full max-w-md">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[12px] font-bold tracking-[0.15em] text-white/40 uppercase">Registros</span>
              <button
                onClick={() =>
                  downloadCsv('manga-sesion', [
                    ['Caravana', 'Acción', 'Dato', 'Hora', 'Estado'],
                    ...records.map((r) => [r.tag, r.action, r.detail, new Date(r.at).toISOString(), r.status]),
                  ])
                }
                className="text-[13px] font-bold text-[#4ade80] underline"
              >
                Exportar CSV
              </button>
            </div>
            <div className="max-h-40 space-y-1 overflow-y-auto">
              {records.slice(0, 30).map((r) => (
                <div key={r.key} className="flex items-center justify-between rounded-lg bg-white/[0.04] px-3 py-2 text-[15px]">
                  <span className="font-mono font-bold text-[#4ade80]">{r.tag}</span>
                  <span className="text-white/70">{r.action} · {r.detail}</span>
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
          {sessionName ? <span className="max-w-[140px] truncate normal-case tracking-normal text-white/80">{sessionName}</span> : 'MANGA'}
          <span className="rounded bg-[#4ade80]/20 px-2 py-0.5 text-[12px] tracking-normal text-[#4ade80]">{mode}</span>
        </span>
        <span className="flex items-center gap-4 font-mono text-[18px] font-bold">
          <span className="text-[#4ade80]">{saved} <span className="text-[12px] font-normal text-white/40">reg</span></span>
          {pending > 0 && <span className="text-[#facc15]">{pending} <span className="text-[12px] font-normal text-white/40">pend</span></span>}
          <span className={errors ? 'text-[#f87171]' : 'text-white/30'}>{errors} <span className="text-[12px] font-normal text-white/40">err</span></span>
        </span>
        <button onClick={() => setPhase('summary')} className="rounded border border-white/30 px-3 py-1.5 text-[13px] text-white/70 hover:text-white">
          Salir
        </button>
      </div>

      {!online && (
        <div className="bg-[#facc15] py-1.5 text-center text-[14px] font-bold text-black">
          SIN CONEXIÓN · los guardados quedan pendientes y se reenvían al reconectar
        </div>
      )}

      <div className={`flex flex-1 flex-col items-center justify-center gap-6 overflow-y-auto px-6 py-6 ${shake ? 'animate-[shake_0.4s]' : ''}`}>
        {!animal ? (
          /* Paso 1: identificar el animal */
          <>
            <div className="flex max-w-full flex-wrap justify-center gap-1.5">
              {MODES.map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`h-8 rounded-full px-3 text-[14px] font-bold ${mode === m ? 'bg-[#4ade80] text-black' : 'bg-white/10 text-white/60'}`}
                >
                  {m}
                </button>
              ))}
            </div>
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
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[12px] font-bold tracking-[0.15em] text-white/40 uppercase">Últimos registros</span>
                  {canUndo && (
                    <button onClick={undoLast} className="text-[13px] font-bold text-[#f87171] underline">Deshacer último</button>
                  )}
                </div>
                <div className="space-y-1">
                  {records.slice(0, 4).map((r) => (
                    <div key={r.key} className="flex items-center justify-between rounded-lg bg-white/[0.04] px-3 py-2 text-[15px]">
                      <span className="flex items-center gap-1.5">
                        <span className={`inline-block size-2 rounded-full ${r.status === 'saved' ? 'bg-[#4ade80]' : r.status === 'pending' ? 'bg-[#facc15]' : 'bg-[#f87171]'}`} />
                        <span className="font-mono font-bold text-[#4ade80]">{r.tag}</span>
                      </span>
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
                  {alerts.map((al) =>
                    al.mode ? (
                      <button
                        key={al.code}
                        onClick={() => setMode(al.mode!)}
                        className={`rounded-lg px-3 py-2 text-[15px] font-bold ${al.tone === 'danger' ? 'bg-[#f87171] text-black' : 'bg-[#facc15] text-black'} ${mode === al.mode ? 'ring-2 ring-white' : ''}`}
                        title={`Ir a ${al.mode}`}
                      >
                        {al.text} →
                      </button>
                    ) : (
                      <span key={al.code} className={`rounded-lg px-3 py-2 text-[15px] font-bold ${al.tone === 'danger' ? 'bg-[#f87171] text-black' : 'bg-[#facc15] text-black'}`}>
                        {al.text}
                      </span>
                    ),
                  )}
                </div>
              ) : null;
            })()}

            {/* Tareas pendientes del animal (integración Tareas E6): completar en 1 toque. */}
            {animalTasks.length > 0 && (
              <div className="w-full max-w-2xl rounded-xl border border-white/15 bg-white/[0.04] px-4 py-3">
                <div className="mb-2 text-[13px] font-bold tracking-[0.12em] text-white/50 uppercase">Tareas pendientes ({animalTasks.length})</div>
                <div className="space-y-1.5">
                  {animalTasks.map((tk) => (
                    <div key={tk.id} className="flex items-center justify-between gap-3">
                      <span className="min-w-0 truncate text-[16px] text-white/90">
                        {tk.days_overdue != null && <span className="mr-1.5 font-bold text-[#f87171]">●</span>}
                        {tk.title}
                      </span>
                      <button
                        onClick={async () => {
                          const res = await fetch(`${API_URL}/tasks/${tk.id}/complete`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders(), 'Idempotency-Key': crypto.randomUUID() } });
                          if (res.ok) {
                            setAnimalTasks((ts) => ts.filter((x) => x.id !== tk.id));
                            setRecords((r) => [{ key: crypto.randomUUID(), tag: animal.tag, action: 'Tarea', detail: tk.title.slice(0, 30), at: Date.now(), status: 'saved' }, ...r]);
                            soundSaved();
                            vibrate(40);
                          } else fail('NO SE PUDO COMPLETAR');
                        }}
                        className="h-9 shrink-0 rounded-lg bg-[#4ade80] px-3 text-[15px] font-bold text-black"
                      >
                        ✓ Hecho
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {mode === 'Pesaje' ? (
              <>
                <div className="flex items-end gap-3">
                  <input
                    ref={kgRef}
                    value={kg}
                    onChange={(e) => { setKg(e.target.value); setConfirmMsg(null); setWarn(null); }}
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
                {!error && warn && !confirmMsg && (
                  <div className="w-full max-w-md rounded-lg bg-[#facc15]/15 px-4 py-2 text-center text-[16px] font-bold text-[#facc15]">⚠ {warn}</div>
                )}
                {confirmMsg && (
                  <div className="w-full max-w-md rounded-lg bg-[#facc15] px-4 py-3 text-center text-[17px] font-bold text-black">⚠ {confirmMsg}</div>
                )}

                <button
                  onClick={save}
                  disabled={!kg || saving}
                  className={`h-[72px] w-full max-w-md rounded-xl text-[24px] font-extrabold text-black disabled:opacity-30 ${confirmMsg ? 'bg-[#facc15]' : 'bg-[#4ade80]'}`}
                >
                  {saving ? 'GUARDANDO…' : confirmMsg ? 'CONFIRMAR Y GUARDAR' : 'GUARDAR Y SIGUIENTE'}
                </button>
                <button onClick={() => (setAnimal(null), setKg(''), setCc(null), setError(''), setWarn(null), setConfirmMsg(null))} className="text-[15px] text-white/50 underline">
                  Cambiar animal
                </button>
              </>
            ) : (
              <>
                {error && <div className="text-[20px] font-bold text-[#f87171]">{error}</div>}
                <MangaCapture
                  animal={animal}
                  mode={mode}
                  catalogs={{ products, lots, bulls }}
                  onSaved={(rec) => {
                    soundSaved();
                    setRecords((r) => [{ key: crypto.randomUUID(), tag: animal.tag, action: rec.action, detail: rec.detail, at: Date.now(), status: 'saved' }, ...r]);
                    setAnimal(null);
                    setError('');
                  }}
                  onError={(msg) => fail(msg)}
                  onCancel={() => (setAnimal(null), setError(''))}
                />
              </>
            )}
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
