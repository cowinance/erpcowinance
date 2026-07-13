import { defineConfig } from 'vitest/config';

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
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      include: ['packages/*/src/**/*.ts', 'apps/api/src/**/*.ts'],
      exclude: ['**/*.{test,spec}.ts', '**/sim/**', '**/index.ts'],
    },
  },
});
