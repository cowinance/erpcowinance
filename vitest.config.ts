import { defineConfig } from 'vitest/config';

/**
 * Vitest a nivel workspace — pruebas de lógica pura y de servidor (entorno
 * node). Cubre packages/* y apps/api; la web y el móvil (React/Expo) tienen
 * su propio toolchain y quedan fuera de este runner.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['packages/**/src/**/*.{test,spec}.ts', 'apps/api/src/**/*.{test,spec}.ts', 'apps/api/test/**/*.{test,spec}.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.next/**', '**/.data/**'],
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      include: ['packages/*/src/**/*.ts', 'apps/api/src/**/*.ts'],
      exclude: ['**/*.{test,spec}.ts', '**/sim/**', '**/index.ts'],
    },
  },
});
