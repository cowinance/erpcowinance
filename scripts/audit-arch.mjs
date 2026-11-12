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
  // Revisado 2026-08-12: era 340 (alerts.service.ts, F9). herd.service.ts creció a 1141 y el
  // indicador imprimía ▼+801 en CADA corrida — una alarma que no puede volver a verde deja de
  // informar y se lee como ruido. El control real es el gate MAX_SERVICE_LINES de más abajo;
  // este número solo mide la tendencia, y para eso tiene que partir de la realidad.
  // Revisado 2026-08-15: tres particiones seguidas —herd (1141→940), alerts (1094→477) y repro
  // (978→795)—. El mayor vuelve a ser herd.service.ts, y ahí la campaña de partir el más grande
  // llegó a su límite útil: lo que le queda es el CRUD del animal, que es UNA cosa.
  largestServiceLines: 940, // herd.service.ts (excl. seed.ts, que es data)
};

const TYPECHECK_TARGETS = [
  ['@cowinance/domain', 'packages/domain/tsconfig.json'],
  ['@cowinance/sync-core', 'packages/sync-core/tsconfig.json'],
  ['@cowinance/design-tokens', 'packages/design-tokens/tsconfig.json'],
  ['@cowinance/api', 'apps/api/tsconfig.json'],
  ['@cowinance/mobile', 'apps/mobile/tsconfig.json'],
];
const COVERAGE_SCOPE = ['/packages/domain/src/', '/packages/sync-core/src/'];

/**
 * Rutas en forma POSIX para comparar. `join()` y el reporte de cobertura usan el
 * separador del sistema, así que en Windows `'a\b'.includes('a/b')` es false y
 * los filtros de abajo no matchean NADA: la cobertura daba 0% (de 73 archivos)
 * y los nombres se imprimían con la ruta completa en vez de relativa.
 */
const posix = (p) => p.split('\\').join('/');
const JSCPD_SCOPE = 'apps/api/src packages/domain/src packages/sync-core/src';
const LARGEST_DIR = 'apps/api/src';

/**
 * Techo de líneas por servicio (gate). Trinquete: bajarlo es una decisión explícita, subirlo
 * debería costar una discusión. Historial: 1417 (herd.service.ts, sin techo) → 1150 al extraer
 * LotsService → 1000 al extraer AnimalIdentifiers/AnimalQuality de herd y AlertRules de alerts.
 *
 * El peor caso quedó en 940 (herd.service.ts). NO se bajó a ~950 a propósito: herd acaba de
 * partirse y lo que le queda —listar, ver, crear y editar el animal— es un solo caso de uso. El
 * próximo recorte tendría que cortar contra la veta, y un techo que obliga a eso deja de proteger
 * el diseño para empezar a deformarlo.
 */
const MAX_SERVICE_LINES = 1000;

/**
 * Techo de líneas por archivo del MÓVIL (gate). Mismo trinquete que el de la API y por la misma
 * razón: `SyncContext.tsx` llegó a 1485 líneas —el doble del siguiente archivo y 485 por encima
 * del techo que la API sí hacía cumplir— sin que nada lo frenara, porque el móvil quedaba fuera
 * de este gate. Esa forma fue la CAUSA de que el archivo más crítico del cliente no tuviera un
 * solo test: para probar el cálculo de un retiro había que montar React, Expo y el almacenamiento.
 * Partirlo por sus costuras lo dejó en 738.
 *
 * Historial: 1485 (SyncContext.tsx, sin techo) → 800 al extraer sync-types, store-queries y
 * capture-actions. El peor caso quedó en 773 (`manga.tsx`) y NO se bajó a ~780 a propósito: manga
 * es una sola pantalla de trabajo y recortarla exigiría cortar contra la veta.
 *
 * Cubre `.ts` y `.tsx`: en el móvil la lógica vive en componentes, así que un techo solo para
 * `.ts` no miraría donde el problema aparece.
 */
const MAX_MOBILE_FILE_LINES = 800;
const MOBILE_DIR = 'apps/mobile/src';

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

// Gate 2c: ninguna caja del móvil con alto FIJO.
//
// En iOS el usuario elige el tamaño del texto, y React Native lo respeta: la letra crece. Un `height`
// fijo no se entera — la caja se queda del mismo alto y el texto la desborda o se recorta. A tamaño
// de accesibilidad el login quedaba sin aire entre el campo y el botón, y en pantalla chica cortaba.
//
// La regla es `minHeight`, que deja crecer la caja y a tamaño normal mide exactamente lo mismo. Este
// gate existe porque el arreglo tocó 19 lugares en 12 archivos: son demasiados para confiar en que la
// próxima pantalla se acuerde. Es la misma historia del arreglo del teclado, donde la lista tenía
// cinco pantallas y la sexta apareció recién al barrer todos los archivos.
//
// La EXCEPCIÓN es un cuadrado: un ícono o un logo con `width` y `height` iguales no lleva texto que
// escale, y ahí el alto fijo es lo correcto. Se reconoce por eso mismo, no por una lista de nombres
// que habría que mantener a mano.
{
  const ofensores = [];
  const revisarMovil = (dir) => {
    for (const f of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, f.name);
      if (f.isDirectory()) {
        if (!['node_modules', 'dist', '.expo'].includes(f.name)) revisarMovil(full);
      } else if (f.name.endsWith('.tsx') || f.name.endsWith('.ts')) {
        const texto = readFileSync(full, 'utf8');
        const lineas = texto.split('\n');
        lineas.forEach((linea, i) => {
          // Un comentario que NOMBRA la regla no la viola — este mismo gate está documentado así.
          if (/^\s*(\/\/|\*|\/\*)/.test(linea)) return;
          const alto = /(?<!min)(?<!max)\bheight:\s*(\d+)/.exec(linea);
          if (!alto) return;
          // Una línea divisoria o un punto de color no llevan texto adentro.
          if (Number(alto[1]) <= 12) return;
          // Cuadrado (ícono/logo): `width: N` con el mismo N, en esta línea o en la anterior.
          const contexto = `${lineas[i - 1] ?? ''} ${linea}`;
          const ancho = /(?<!min)(?<!max)\bwidth:\s*(\d+)/.exec(contexto);
          if (ancho && ancho[1] === alto[1]) return;
          // La barra de pestañas la dimensiona el navegador, no la caja.
          if (linea.includes('tabBarStyle')) return;
          ofensores.push(`${full}:${i + 1}`);
        });
      }
    }
  };
  try {
    revisarMovil('apps/mobile/src');
  } catch {
    /* un directorio ausente no bloquea el gate */
  }
  gate(
    'sin alto fijo en el móvil (Dynamic Type)',
    ofensores.length === 0,
    ofensores.length ? ofensores.slice(0, 3).join(' · ') : '',
  );
}

// Gate 2d: todo lo que se toca en el móvil se anuncia como tal.
//
// Un `Pressable` sin `accessibilityRole` ni `accessibilityLabel` lo lee TalkBack o VoiceOver como
// texto suelto: quien no ve la pantalla no se entera de que ahí hay algo para tocar. Eran 65 de
// 82 cuando se midió, y la razón de que fueran tantos es que nada lo frenaba — exactamente la
// misma historia que los altos fijos.
//
// Alcanza con UNO de los dos: con texto visible adentro, el rol basta y una etiqueta encima lo
// TAPARÍA; sin texto (un ícono solo), hace falta la etiqueta.
{
  const ofensores = [];
  const revisar = (dir) => {
    for (const f of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, f.name);
      if (f.isDirectory()) {
        if (!['node_modules', 'dist', '.expo'].includes(f.name)) revisar(full);
      } else if (f.name.endsWith('.tsx')) {
        const texto = readFileSync(full, 'utf8');
        let i = 0;
        while ((i = texto.indexOf('<Pressable', i)) >= 0) {
          // Fin de la etiqueta de apertura: el primer `>` fuera de llaves.
          let llaves = 0;
          let fin = -1;
          for (let j = i; j < texto.length; j++) {
            const c = texto[j];
            if (c === '{') llaves++;
            else if (c === '}') llaves--;
            else if (c === '>' && llaves === 0) {
              fin = j;
              break;
            }
          }
          const etiqueta = texto.slice(i, fin < 0 ? texto.length : fin);
          if (!/accessibilityRole|accessibilityLabel/.test(etiqueta)) {
            ofensores.push(`${posix(full)}:${texto.slice(0, i).split('\n').length}`);
          }
          i = fin < 0 ? i + 10 : fin;
        }
      }
    }
  };
  try {
    revisar('apps/mobile/src');
  } catch {
    /* un directorio ausente no bloquea el gate */
  }
  gate(
    'todo lo tocable del móvil se anuncia (accesibilidad)',
    ofensores.length === 0,
    ofensores.length ? ofensores.slice(0, 3).join(' · ') : '',
  );
  if (ofensores.length > 0)
    console.log(dim('    con texto visible alcanza accessibilityRole; un ícono solo necesita accessibilityLabel.'));
}

// Gate 2f: toda pantalla del móvil tiene por dónde desplazarse.
//
// La pantalla de Capturar mostraba doce tarjetas en una grilla dentro de un `View` con `flex: 1`.
// En el navegador —donde se verificó TODO hasta que la app corrió en un teléfono— las doce entran
// y no pasa nada. En un teléfono las últimas cuatro quedaban cortadas y no había forma de llegar a
// ellas: ni Destete, ni Nota, ni Baja, ni Parto existían para quien usara la app.
//
// Es el tipo de defecto que no se ve leyendo el código ni corriendo tests, solo en un dispositivo
// real, y por eso conviene que lo vigile una máquina. Lo encontró el dueño del proyecto a los diez
// minutos de instalar el primer APK.
//
// Se aceptan `ScrollView`, `FlatList`, `SectionList` y `FormScroll` (el envoltorio propio que
// además maneja el teclado). Quedan fuera los `_layout` —que componen, no muestran contenido— y
// las rutas que solo redirigen.
{
  const sinScroll = [];
  const CONTENEDORES = /ScrollView|FlatList|SectionList|FormScroll/;
  const recorrer = (dir) => {
    for (const f of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, f.name);
      if (f.isDirectory()) {
        recorrer(full);
      } else if (f.name.endsWith('.tsx') && f.name !== '_layout.tsx') {
        const texto = readFileSync(full, 'utf8');
        // Una ruta que solo redirige no tiene contenido que desplazar.
        if (/<Redirect\b/.test(texto)) continue;
        if (!CONTENEDORES.test(texto)) sinScroll.push(full.replace(/\\/g, '/'));
      }
    }
  };
  try {
    recorrer('apps/mobile/src/app');
  } catch {
    /* un directorio ausente no bloquea el gate */
  }
  gate(
    'toda pantalla del móvil se puede desplazar',
    sinScroll.length === 0,
    sinScroll.length ? sinScroll.slice(0, 3).join(' · ') : '',
  );
  if (sinScroll.length > 0)
    console.log(dim('    envolvé el contenido en ScrollView o FormScroll; en un teléfono no entra lo que en el navegador sí.'));
}

// Gate 2e: el linter del móvil, en cero.
//
// POR QUÉ ES UN GATE. El script `lint` existía desde el principio y NUNCA había corrido: faltaban
// las dependencias de ESLint, así que `npm run lint` fallaba y nadie lo notó. Al habilitarlo
// aparecieron 40 errores acumulados, casi todos del React Compiler —que este proyecto tiene
// activado— sobre leer refs durante el render y encadenar renders desde efectos. Un linter que
// no corre es peor que no tener linter: da la impresión de que algo mira.
//
// Cero ADVERTENCIAS además de cero errores (`--max-warnings 0`): las advertencias de
// `exhaustive-deps` son justamente las que preceden a un bug de datos viejos en pantalla.
{
  const r = trySh('npm run lint --prefix apps/mobile -- --max-warnings 0');
  gate('el móvil pasa su linter (0 errores, 0 advertencias)', r.ok, r.ok ? '' : 'corré: npm run lint --prefix apps/mobile');
  if (!r.ok) console.log(dim(r.out.split('\n').slice(-12).join('\n')));
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
function tsFiles(dir, exts = ['.ts']) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...tsFiles(p, exts));
    else if (exts.some((e) => name.endsWith(e)) && !/\.(test|spec)\.tsx?$/.test(name)) out.push(p);
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
    : overBudget.map((s) => `${posix(s.f).replace(LARGEST_DIR + '/', '')} (${s.n})`).join(', '),
);
if (overBudget.length > 0)
  console.log(dim('    partilo por caso de uso; ver LotsService, extraído de HerdService por esta misma razón.'));

// Gate 4b: el mismo presupuesto, para el móvil.
const mobileSizes = tsFiles(MOBILE_DIR, ['.ts', '.tsx'])
  .map((f) => ({ f, n: readFileSync(f, 'utf8').split('\n').length }))
  .sort((a, b) => b.n - a.n);
const mobileOver = mobileSizes.filter((s) => s.n > MAX_MOBILE_FILE_LINES);
gate(
  `ningún archivo del móvil supera ${MAX_MOBILE_FILE_LINES} líneas`,
  mobileOver.length === 0,
  mobileOver.length === 0
    ? `mayor: ${mobileSizes[0]?.n ?? 0}`
    : mobileOver.map((s) => `${posix(s.f).replace(MOBILE_DIR + '/', '')} (${s.n})`).join(', '),
);
if (mobileOver.length > 0)
  console.log(dim('    cortá por las costuras que el archivo ya tiene; ver store-queries y capture-actions, extraídos de SyncContext.'));

// ───────────────────────── QUALITY INDICATORS ─────────────────────────
console.log(bold('\n══ QUALITY INDICATORS ') + dim('(informan — nunca bloquean; delta vs baseline)'));

// Indicador 1: cobertura acotada a lo unit-testeable (domain + sync-core).
try {
  const summary = JSON.parse(readFileSync('coverage/coverage-summary.json', 'utf8'));
  let covered = 0,
    total = 0;
  for (const [file, v] of Object.entries(summary)) {
    if (file === 'total') continue;
    if (COVERAGE_SCOPE.some((s) => posix(file).includes(s))) {
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
for (const { f, n } of sizes) console.log(dim(`    ${String(n).padStart(4)}  ${posix(f).replace(LARGEST_DIR + '/', '')}`));
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
