'use client';

/**
 * Modo manga (doc diseño §12.3): captura masiva en campo.
 * Alto contraste AAA, targets gigantes operables con guantes, feedback
 * auditivo (nadie mira la pantalla fijo con una vaca empujando la manga).
 * El modo campo ignora el tema: negro puro + blanco puro + acentos saturados.
 */
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { API_URL } from '@/lib/api';

interface Animal {
  id: string;
  tag: string;
  name?: string;
  category?: string;
  last_weight_kg?: number;
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
        headers: { 'Content-Type': 'application/json' },
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
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
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
            <div className="text-center">
              <div className="font-mono text-[64px] leading-none font-bold text-[#4ade80]">{animal.tag}</div>
              <div className="mt-2 text-[17px] text-white/60">
                {animal.category}
                {animal.last_weight_kg ? ` · último ${Math.round(animal.last_weight_kg)} kg` : ''}
              </div>
            </div>

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
