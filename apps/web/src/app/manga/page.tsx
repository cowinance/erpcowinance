'use client';

/**
 * Modo manga (doc diseño §12.3): captura masiva en campo.
 * Alto contraste AAA, targets gigantes operables con guantes, feedback
 * auditivo (nadie mira la pantalla fijo con una vaca empujando la manga).
 * El modo campo ignora el tema: negro puro + blanco puro + acentos saturados.
 */
import { useEffect, useRef, useState } from 'react';
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

/** Alertas rápidas derivadas de la tarjeta (máx 3, accionables). Amarillo/rojo por severidad. */
function cardAlerts(a: Animal): { text: string; tone: 'danger' | 'warning' }[] {
  const out: { text: string; tone: 'danger' | 'warning' }[] = [];
  if (a.has_withdrawal) out.push({ text: `RETIRO ACTIVO${a.meat_withdrawal_until ? ` hasta ${fmtDate(a.meat_withdrawal_until)}` : ''}`, tone: 'danger' });
  if ((a.open_cases ?? 0) > 0) out.push({ text: `CASO CLÍNICO ABIERTO${a.case_severity === 'severe' ? ' (grave)' : ''}`, tone: 'danger' });
  if (a.expected_due_date) {
    const days = Math.round((new Date(a.expected_due_date).getTime() - Date.now()) / 86400000);
    if (days <= 21 && days >= -10) out.push({ text: `PARTO PRÓXIMO (${days <= 0 ? 'vencido' : `${days} d`})`, tone: 'warning' });
  }
  if (!a.lot_id) out.push({ text: 'SIN LOTE', tone: 'warning' });
  if (a.days_since_weighing == null || a.days_since_weighing > 90) out.push({ text: a.days_since_weighing == null ? 'SIN PESAJE' : 'SIN PESAJE RECIENTE', tone: 'warning' });
  return out.slice(0, 3);
}

function fmtDate(d: string): string {
  return new Date(d).toLocaleDateString('es-AR', { day: '2-digit', month: 'short' });
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

export default function MangaPage() {
  const [animal, setAnimal] = useState<Animal | null>(null);
  const [tag, setTag] = useState('');
  const [kg, setKg] = useState('');
  const [cc, setCc] = useState<number | null>(null);
  const [count, setCount] = useState(0);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [shake, setShake] = useState(false);
  const tagRef = useRef<HTMLInputElement>(null);
  const kgRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (animal ? kgRef : tagRef).current?.focus();
  }, [animal]);

  function fail(msg: string) {
    setError(msg);
    soundError();
    setShake(true);
    setTimeout(() => setShake(false), 400);
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
      setCount((c) => c + 1);
      setLastSaved(`${animal.tag} · ${kg} kg`);
      setAnimal(null);
      setKg('');
      setCc(null);
    } catch {
      fail('SIN CONEXIÓN CON LA API');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black text-white select-none">
      {/* Barra superior: progreso siempre visible */}
      <div className="flex h-14 items-center justify-between border-b border-white/20 px-5">
        <span className="text-[13px] font-bold tracking-[0.2em] text-white/60">MODO MANGA</span>
        <span className="font-mono text-[20px] font-bold text-[#4ade80]">
          {count} {count === 1 ? 'registrado' : 'registrados'}
        </span>
        <Link href="/" className="rounded border border-white/30 px-3 py-1.5 text-[13px] text-white/70 hover:text-white">
          Salir
        </Link>
      </div>

      <div className={`flex flex-1 flex-col items-center justify-center gap-6 px-6 ${shake ? 'animate-[shake_0.4s]' : ''}`}>
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
            {lastSaved && !error && (
              <div className="text-[15px] text-white/50">
                Último guardado: <span className="font-mono text-[#4ade80]">{lastSaved}</span>
              </div>
            )}
            <button
              onClick={lookup}
              disabled={!tag.trim()}
              className="h-[72px] w-full max-w-md rounded-xl bg-white text-[24px] font-extrabold text-black disabled:opacity-30"
            >
              BUSCAR
            </button>
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
                    <span
                      key={al.text}
                      className={`rounded-lg px-3 py-2 text-[15px] font-bold ${al.tone === 'danger' ? 'bg-[#f87171] text-black' : 'bg-[#facc15] text-black'}`}
                    >
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
              <div className="mb-2 text-center text-[13px] font-bold tracking-[0.15em] text-white/50 uppercase">
                Condición corporal
              </div>
              <div className="grid grid-cols-6 gap-2">
                {CC_OPTIONS.map((v) => (
                  <button
                    key={v}
                    onClick={() => setCc(cc === v ? null : v)}
                    className={`h-14 rounded-lg text-[20px] font-bold ${
                      cc === v ? 'bg-[#4ade80] text-black' : 'bg-white/10 text-white/80'
                    }`}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>

            {error && <div className="text-[20px] font-bold text-[#f87171]">{error}</div>}

            <button
              onClick={save}
              disabled={!kg}
              className="h-[72px] w-full max-w-md rounded-xl bg-[#4ade80] text-[24px] font-extrabold text-black disabled:opacity-30"
            >
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
  if (animal.sex === 'F' && animal.expected_due_date)
    facts.push({ label: 'Preñada', value: `parto ~${fmtDate(animal.expected_due_date)}` });

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
