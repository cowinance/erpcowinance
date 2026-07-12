/**
 * Config de runtime de push (P7-3.c.2). Provider pequeño e inmutable inyectado en el
 * `PushProcessor` — que NO lee `process.env`. Fuente única de la decisión de habilitación.
 */
export interface PushRuntimeConfig {
  enabled: boolean;
}

export const PUSH_RUNTIME_CONFIG = Symbol('PUSH_RUNTIME_CONFIG');

/**
 * Semántica de `PUSH_ENABLED`: ausente/vacío/`'false'` → deshabilitado; `'true'` → habilitado;
 * cualquier otro valor → error de configuración (boot falla con mensaje claro, sin degradar).
 */
export function parsePushEnabled(raw: string | undefined): boolean {
  if (raw === undefined || raw === '' || raw === 'false') return false;
  if (raw === 'true') return true;
  throw new Error(`Config inválida: PUSH_ENABLED="${raw}" (esperado 'true' | 'false' | ausente)`);
}
