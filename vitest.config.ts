import { defineConfig } from 'vitest/config';
import { availableParallelism, totalmem } from 'node:os';

const GB = 1024 ** 3;

/**
 * Techo de workers en paralelo — el límite es la MEMORIA, no los cores.
 *
 * Casi toda prueba de integración levanta su PROPIA PGlite y le carga el DDL completo más el seed
 * demo. Con el default de vitest (un worker por core, menos uno), una máquina de 16 cores y 11 GB
 * abría 15 workers, se quedaba sin RAM y el runner los mataba: la corrida terminaba **sin reportar
 * un solo test en rojo**. Esa es la peor forma de fallar — se lee como si el código estuviera roto
 * y manda a buscar el problema donde no está. El CI nunca lo vio porque `ubuntu-latest` tiene 4
 * cores y el default ya le daba 3.
 *
 * Medido sobre la suite completa (agosto 2026): pico de 0.48 GB por worker. Se presupuestan 0.75
 * —50% de margen para que el seed pueda crecer sin que esto vuelva a morder— sobre la MITAD de la
 * RAM física; la otra mitad es del sistema, el editor y los servidores de desarrollo.
 *
 * Donde sobra memoria manda el término de cores, así que en CI el número NO cambia.
 */
const MEMORIA_POR_WORKER_GB = 0.75;
const maxWorkers = Math.max(
  1,
  Math.min(availableParallelism() - 1, Math.floor(totalmem() / GB / 2 / MEMORIA_POR_WORKER_GB)),
);

/**
 * Vitest a nivel workspace — pruebas de lógica pura y de servidor (entorno
 * node). Cubre packages/* y apps/api; la web y los COMPONENTES React/Expo del
 * móvil tienen su propio toolchain y quedan fuera de este runner. Excepción: la
 * lógica PURA del móvil (sin React/Expo), p. ej. los builders de captura de
 * SyncContext (P5-2), sí se cubre acá — son funciones puras testeables en node.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'packages/**/src/**/*.{test,spec}.ts',
      'apps/api/src/**/*.{test,spec}.ts',
      'apps/api/test/**/*.{test,spec}.ts',
      'apps/mobile/src/**/*.{test,spec}.ts',
      // Solo helpers PUROS `.ts` de la web (no .tsx/React); habilita testear utilidades como
      // lib/protocol-calendar en el gate (R-2.b.2). apps/web sigue verificándose por Playwright.
      'apps/web/src/**/*.{test,spec}.ts',
    ],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.next/**', '**/.data/**'],
    /**
     * Hooks: 120 s. Casi todas las pruebas de integración arrancan una PGlite propia y le cargan
     * el DDL canónico en un `before*`; con la suite completa en paralelo y la máquina cargada ese
     * arranque puede pasarse del default de 10 s y producir ROJOS INTERMITENTES ajenos al código
     * (se detectó así en `identity/email-action-token`). Es el mismo margen que ya declaraban a
     * mano la mayoría de los archivos; acá cubre también a los que no lo hacían.
     *
     * `testTimeout` se deja en el default a propósito: un test que se cuelga suele ser un deadlock
     * real (p. ej. consultar por fuera de la tx con la conexión única de PGlite) y conviene que
     * falle rápido en vez de esperar dos minutos.
     */
    hookTimeout: 120_000,
    maxWorkers,
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      include: ['packages/*/src/**/*.ts', 'apps/api/src/**/*.ts'],
      exclude: ['**/*.{test,spec}.ts', '**/sim/**', '**/index.ts'],
    },
  },
});
