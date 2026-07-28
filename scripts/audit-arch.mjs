#!/usr/bin/env node
/**
 * audit:arch — verificación arquitectónica reproducible del monorepo (F9).
 *
 * Filosofía (ADR de F9 / quality-baseline.md), dos categorías separadas:
 *
 *   ARCHITECTURE GATES  → invariantes que NUNCA deben romperse. Bloquean
 *                         (exit ≠ 0). Binarios y no arbitrarios.
 *   QUALITY INDICATORS  → señales que ayudan a decidir. NUNCA bloquean
 *                         (siempre exit 0 en esta sección). Se imprimen con
 *                         su delta vs. el baseline para ver la tendencia.
 *
 * Objetivo: detectar regresiones arquitectónicas y proteger invariantes, sin
 * obligar a optimizar números subjetivos. Estático y rápido (sin servidor):
 * los gates de runtime (auth-e2e, sync-e2e, sim de convergencia) requieren la
 * API corriendo y quedan FUERA de este script, a propósito.
 *
 * CI-ready: un futuro CI solo necesita `npm run audit:arch`; el exit code
 * refleja el estado de los gates. No se instala CI acá.
 */
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * Baseline registrado en F9 (post Foundation Hardening Sprint). Se actualiza
 * de forma CONSCIENTE cuando un número cambia a propósito — no automáticamente.
 * Ver docs/quality-baseline.md.
 */
const BASELINE = {
  coveragePct: 72.54, // domain + sync-core (lo unit-testeable); la api se prueba por E2E
  jscpdPct: 4.17, // clones sintácticos en el código propio (no semánticos)
  largestServiceLines: 340, // alerts.service.ts (excl. seed.ts, que es data)
};

const TYPECHECK_TARGETS = [
  ['@cowinance/domain', 'packages/domain/tsconfig.json'],
  ['@cowinance/sync-core', 'packages/sync-core/tsconfig.json'],
  ['@cowinance/design-tokens', 'packages/design-tokens/tsconfig.json'],
  ['@cowinance/api', 'apps/api/tsconfig.json'],
  ['@cowinance/mobile', 'apps/mobile/tsconfig.json'],
];
const COVERAGE_SCOPE = ['/packages/domain/src/', '/packages/sync-core/src/'];
const JSCPD_SCOPE = 'apps/api/src packages/domain/src packages/sync-core/src';
const LARGEST_DIR = 'apps/api/src';

/**
 * Techo de líneas por servicio (gate). Trinquete: bajarlo es una decisión explícita, subirlo
 * debería costar una discusión. Historial: 1417 (herd.service.ts, sin techo) → 1150 al extraer
 * LotsService.
 */
const MAX_SERVICE_LINES = 1150;

const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;

function sh(cmd) {
  return execSync(cmd, { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] }).toString();
}
function trySh(cmd) {
  try {
    return { ok: true, out: sh(cmd) };
  } catch (e) {
    return { ok: false, out: (e.stdout?.toString() ?? '') + (e.stderr?.toString() ?? '') };
  }
}
function delta(current, base, lowerIsBetter = false) {
  const d = +(current - base).toFixed(2);
  if (d === 0) return dim('= igual que baseline');
  const worse = lowerIsBetter ? d > 0 : d < 0;
  const sign = d > 0 ? '+' : '';
  return `${worse ? red('▼') : green('▲')} ${sign}${d} vs baseline ${base}`;
}

// ───────────────────────── ARCHITECTURE GATES ─────────────────────────
let gateFailed = false;
const gate = (name, ok, detail = '') => {
  console.log(`  ${ok ? green('✓') : red('✗')} ${name}${detail ? dim('  ' + detail) : ''}`);
  if (!ok) gateFailed = true;
};

console.log(bold('\n══ ARCHITECTURE GATES ') + dim('(bloquean — invariantes no negociables)'));

// Gate 0: tokens — la fuente canónica única genera el artefacto CSS de la web sin
// deriva manual (P1.4.1, ADR-0013). Corre PRIMERO: `tokens:check` construye
// @cowinance/design-tokens (su dist lo necesita el typecheck de mobile) y compara
// el CSS generado contra el commiteado SIN modificar archivos (nunca autocorrige).
{
  const r = trySh('npm run tokens:check');
  gate('tokens (fuente única, sin deriva)', r.ok, r.ok ? '' : 'corré: npm run tokens:build');
  if (!r.ok) console.log(dim(r.out.split('\n').slice(-6).join('\n')));
}

// Gate 1: typecheck de cada workspace TypeScript propio.
for (const [name, tsconfig] of TYPECHECK_TARGETS) {
  const r = trySh(`npx tsc --noEmit -p ${tsconfig}`);
  gate(`typecheck ${name}`, r.ok, r.ok ? '' : 'ver errores arriba');
  if (!r.ok) console.log(dim(r.out.split('\n').slice(0, 8).join('\n')));
}

// Gate 2: tests (vitest) + genera coverage para la sección de indicadores.
const testRun = trySh('npx vitest run --coverage --coverage.reporter=json-summary --coverage.reporter=text');
const testsPassed = /Tests\s+(\d+)\s+passed/.exec(testRun.out)?.[1];
gate('tests (vitest run)', testRun.ok, testsPassed ? `${testsPassed} passed` : '');

// Gate 2b: ningún backtick en un comentario SQL.
//
// Un backtick dentro de una consulta CIERRA la cadena de JavaScript. A veces eso da un error de
// sintaxis y lo agarra el typecheck; otras produce JS válido —un identificador suelto— y explota
// recién en runtime con un ReferenceError que no se parece en nada a la causa. Pasó CINCO veces en
// una sola sesión, siempre igual: citando un nombre de columna con backticks al comentar el SQL.
//
// La regla es la forma exacta del error: una línea de comentario SQL que contiene un backtick. Los
// comentarios SQL solo viven dentro de consultas, así que ahí un backtick nunca es intencional.
{
  const ofensores = [];
  const revisar = (dir) => {
    for (const f of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, f.name);
      if (f.isDirectory()) {
        if (!['node_modules', 'dist', '.next', 'coverage'].includes(f.name)) revisar(full);
      } else if (f.name.endsWith('.ts') && !f.name.endsWith('.d.ts')) {
        readFileSync(full, 'utf8')
          .split('\n')
          .forEach((linea, i) => {
            if (/^\s*--/.test(linea) && linea.includes('`')) ofensores.push(`${full}:${i + 1}`);
          });
      }
    }
  };
  for (const dir of ['apps/api/src', 'packages']) {
    try {
      revisar(dir);
    } catch {
      /* un directorio ausente no bloquea el gate */
    }
  }
  gate(
    'sin backticks en comentarios SQL',
    ofensores.length === 0,
    ofensores.length ? ofensores.slice(0, 3).join(' · ') : '',
  );
}

// Gate 3: cero dependencias circulares (madge).
const madge = trySh(`npx madge --extensions ts --circular --json ${LARGEST_DIR}`);
let cycles = -1;
try {
  cycles = JSON.parse(madge.out).length;
} catch {
  /* madge falló */
}
gate('cero ciclos de dependencia (madge)', madge.ok && cycles === 0, cycles >= 0 ? `${cycles} ciclos` : 'madge error');

// Gate 4: presupuesto de tamaño por servicio.
//
// POR QUÉ ES UN GATE Y NO UN INDICADOR: como indicador, `herd.service.ts` creció hasta 1417 líneas
// —cuatro veces el servicio más grande de cuando se fijó la baseline— sin que nada lo frenara. Un
// número que solo se informa no cambia decisiones.
//
// El techo es un TRINQUETE, no un objetivo: está apenas por encima del peor caso actual, así que
// impide crecer pero no exige refactorizar hoy. Bajarlo es trabajo deliberado, y cada vez que se
// baje queda registrado acá.
function tsFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...tsFiles(p));
    else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) out.push(p);
  }
  return out;
}
const allSizes = tsFiles(LARGEST_DIR)
  .map((f) => ({ f, n: readFileSync(f, 'utf8').split('\n').length }))
  .sort((a, b) => b.n - a.n);
const overBudget = allSizes.filter((s) => s.f.includes('.service.ts') && s.n > MAX_SERVICE_LINES);
gate(
  `ningún servicio supera ${MAX_SERVICE_LINES} líneas`,
  overBudget.length === 0,
  overBudget.length === 0
    ? `mayor: ${allSizes.find((s) => s.f.includes('.service.ts'))?.n ?? 0}`
    : overBudget.map((s) => `${s.f.replace(LARGEST_DIR + '/', '')} (${s.n})`).join(', '),
);
if (overBudget.length > 0)
  console.log(dim('    partilo por caso de uso; ver LotsService, extraído de HerdService por esta misma razón.'));

// ───────────────────────── QUALITY INDICATORS ─────────────────────────
console.log(bold('\n══ QUALITY INDICATORS ') + dim('(informan — nunca bloquean; delta vs baseline)'));

// Indicador 1: cobertura acotada a lo unit-testeable (domain + sync-core).
try {
  const summary = JSON.parse(readFileSync('coverage/coverage-summary.json', 'utf8'));
  let covered = 0,
    total = 0;
  for (const [file, v] of Object.entries(summary)) {
    if (file === 'total') continue;
    if (COVERAGE_SCOPE.some((s) => file.includes(s))) {
      covered += v.lines.covered;
      total += v.lines.total;
    }
  }
  const pct = total ? +((covered / total) * 100).toFixed(2) : 0;
  console.log(`  cobertura (domain + sync-core): ${bold(pct + '%')}  ${delta(pct, BASELINE.coveragePct)}`);
  console.log(dim('    nota: la api se prueba por E2E (no vitest); su baja cobertura vitest es esperada, no una brecha.'));
} catch {
  console.log(`  cobertura: ${dim('no disponible (coverage-summary.json no generado)')}`);
}

// Indicador 2: duplicación (jscpd) — clones SINTÁCTICOS, no semánticos.
const jscpdOut = mkdtempSync(join(tmpdir(), 'jscpd-'));
const jscpd = trySh(`npx jscpd ${JSCPD_SCOPE} --silent --reporters json --output ${jscpdOut}`);
if (jscpd.ok) {
  try {
    const rep = JSON.parse(readFileSync(join(jscpdOut, 'jscpd-report.json'), 'utf8')).statistics.total;
    const pct = +rep.percentage.toFixed(2);
    console.log(`  duplicación (jscpd): ${bold(pct + '%')} (${rep.clones} clones)  ${delta(pct, BASELINE.jscpdPct, true)}`);
    console.log(dim('    nota: jscpd ve clones sintácticos; la duplicación de REGLAS (semántica) la enforcea la revisión, no el tool.'));
  } catch {
    console.log(`  duplicación: ${dim('no disponible')}`);
  }
} else {
  console.log(`  duplicación: ${dim('jscpd error')}`);
}

// Indicador 3: watch de God-object — archivos fuente más grandes (el techo ya es un gate arriba).
const sizes = allSizes.slice(0, 5);
console.log(`  archivos fuente más grandes (${LARGEST_DIR}):`);
for (const { f, n } of sizes) console.log(dim(`    ${String(n).padStart(4)}  ${f.replace(LARGEST_DIR + '/', '')}`));
const largestService = sizes.find((s) => s.f.includes('.service.ts'))?.n ?? 0;
console.log(`    servicio más grande: ${bold(largestService + ' líneas')}  ${delta(largestService, BASELINE.largestServiceLines, true)}`);

// ───────────────────────── RESULTADO ─────────────────────────
console.log('');
if (gateFailed) {
  console.log(red(bold('✗ ARCHITECTURE GATES: FALLÓ')) + dim(' — un invariante se rompió; corregir antes de mergear.'));
  process.exit(1);
}
console.log(green(bold('✓ ARCHITECTURE GATES: OK')) + dim(' — invariantes intactos. Los indicadores son informativos.'));
process.exit(0);
