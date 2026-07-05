/**
 * Suite de simulación de convergencia — criterio de salida de Fase 0 (Roadmap §3.2):
 * "Dos dispositivos editando offline los mismos datos convergen sin intervención
 *  en el 99%+ de los escenarios de la suite."
 *
 * Cada escenario: 2-4 dispositivos con relojes desviados editan offline
 * (altas, atributos, estados terminales concurrentes, caravanas duplicadas,
 * pesajes), sincronizan en órdenes aleatorios y con reintentos; al final todos
 * los dispositivos y el servidor deben tener EXACTAMENTE el mismo estado.
 */
import { SyncDevice } from '../device';
import { SyncServerCore } from '../server';

function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface ScenarioResult {
  ok: boolean;
  devices: number;
  changesets: number;
  ops: number;
  conflicts: { semantic: number; duplicate: number };
  detail?: string;
}

let uuidCounter = 0;
function fakeUuid(rand: () => number): string {
  // uuid determinista por escenario (reproducibilidad de la suite)
  return `anim-${(++uuidCounter).toString(36)}-${Math.floor(rand() * 1e9).toString(36)}`;
}

async function runScenario(seed: number): Promise<ScenarioResult> {
  const rand = rng(seed);
  const pick = <T>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];
  const server = new SyncServerCore();

  // Transporte no confiable: a veces el ack se pierde (el cliente reenvía →
  // dedupe exactly-once) y a veces el pull no persiste el cursor (el cliente
  // re-aplica lo mismo → idempotencia del merge).
  const transport = {
    push: (cs: Parameters<SyncServerCore['push']>[0]) => {
      const res = server.push(cs);
      if (rand() < 0.2) server.push(cs); // reenvío por ack perdido
      return res;
    },
    pull: (after: number, exclude?: string) => {
      const res = server.pull(after, exclude);
      if (rand() < 0.15) return { ...res, cursor: after + Math.floor((res.cursor - after) * rand()) };
      return res;
    },
  };

  const nDevices = 2 + Math.floor(rand() * 3); // 2-4
  const base = 1_780_000_000_000 + Math.floor(rand() * 1e9);
  let logical = 0;
  const devices: SyncDevice[] = [];
  for (let d = 0; d < nDevices; d++) {
    const skewMs = Math.floor((rand() - 0.5) * 10 * 60_000); // ±5 min de desvío de reloj
    devices.push(new SyncDevice(`dev-${seed}-${d}`, () => base + skewMs + ++logical));
  }

  // Estado inicial compartido: el dispositivo 0 da de alta animales y todos lo reciben
  const animals: string[] = [];
  const usedTags: string[] = [];
  const nInitial = 3 + Math.floor(rand() * 5);
  for (let i = 0; i < nInitial; i++) {
    const id = fakeUuid(rand);
    const tag = String(100 + Math.floor(rand() * 400));
    devices[0].setFields('animals', id, { visual_tag: tag, name: null, status: 'active', current_lot_id: null });
    animals.push(id);
    usedTags.push(tag);
  }
  devices[0].commit();
  await devices[0].sync(transport);
  for (const d of devices) await d.sync(transport);

  // Fase offline: acciones aleatorias intercaladas con syncs parciales
  let ops = 0;
  const nActions = 10 + Math.floor(rand() * 50);
  for (let i = 0; i < nActions; i++) {
    const d = pick(devices);
    const roll = rand();
    if (roll < 0.1) {
      // alta de animal; a veces con caravana repetida (duplicado de campo)
      const id = fakeUuid(rand);
      const tag = rand() < 0.25 && usedTags.length ? pick(usedTags) : String(500 + Math.floor(rand() * 400));
      d.setFields('animals', id, { visual_tag: tag, name: null, status: 'active', current_lot_id: null });
      animals.push(id);
      usedTags.push(tag);
      ops++;
    } else if (roll < 0.45) {
      d.setFields('animals', pick(animals), {
        [pick(['name', 'current_lot_id', 'notes'])]: `v${Math.floor(rand() * 1000)}`,
      });
      ops++;
    } else if (roll < 0.55) {
      // estado terminal (muerte/venta) — puede chocar con el de otro dispositivo
      d.setFields('animals', pick(animals), { status: pick(['dead', 'sold', 'culled']) });
      ops++;
    } else if (roll < 0.85) {
      d.addEvent('weighings', fakeUuid(rand), {
        animal_id: pick(animals),
        weight_kg: 100 + Math.floor(rand() * 500),
        weighed_at: new Date(base + i * 60000).toISOString(),
      });
      ops++;
    } else if (roll < 0.93) {
      d.commit();
    } else {
      await d.sync(transport);
    }
  }

  // Convergencia final: todos empujan, y luego todos hacen pull de lo restante
  for (const d of devices) await d.sync(transport);
  for (const d of devices) await d.sync(transport);
  // Reintento completo (simula corte de red post-push): el dedupe debe absorberlo
  await devices[0].sync(transport);

  const serverFp = server.store.fingerprint();
  const bad = devices.find((d) => d.store.fingerprint() !== serverFp);

  return {
    ok: !bad,
    devices: nDevices,
    changesets: server.log.length,
    ops,
    conflicts: {
      semantic: server.conflicts.filter((c) => c.type === 'semantic').length,
      duplicate: server.conflicts.filter((c) => c.type === 'duplicate').length,
    },
    detail: bad ? `dispositivo ${bad.deviceId} difiere del servidor (seed ${seed})` : undefined,
  };
}

async function main() {
  const N = Number(process.argv[2] ?? 2000);
  let okCount = 0;
  let totalCs = 0;
  let totalOps = 0;
  let semantic = 0;
  let duplicate = 0;
  const failures: string[] = [];

  const t0 = Date.now();
  for (let seed = 1; seed <= N; seed++) {
    const r = await runScenario(seed);
    if (r.ok) okCount++;
    else if (r.detail) failures.push(r.detail);
    totalCs += r.changesets;
    totalOps += r.ops;
    semantic += r.conflicts.semantic;
    duplicate += r.conflicts.duplicate;
  }
  const ms = Date.now() - t0;

  const pct = ((okCount / N) * 100).toFixed(2);
  console.log('── Suite de simulación de convergencia (sync v0) ──');
  console.log(`Escenarios:            ${N} (${ms} ms)`);
  console.log(`Convergencia:          ${okCount}/${N} (${pct}%)`);
  console.log(`Changesets procesados: ${totalCs}`);
  console.log(`Operaciones:           ${totalOps}`);
  console.log(`Conflictos detectados: ${semantic} semánticos (estado terminal), ${duplicate} duplicados de caravana`);
  if (failures.length) {
    console.log('\nFALLAS:');
    for (const f of failures.slice(0, 10)) console.log(' -', f);
    process.exit(1);
  }
  console.log('\nCriterio de salida Fase 0 (>99%): ' + (okCount / N >= 0.99 ? 'CUMPLIDO ✓' : 'NO CUMPLIDO ✗'));
}

main();
