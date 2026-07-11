/**
 * Estilos COMPARTIDOS de los controles de formulario (Input y Select) — P1.4.4.2a.
 *
 * No es un primitivo ni renderiza JSX: es la ÚNICA fuente de la apariencia de la
 * cáscara de control (una regla en un solo lugar), para que Input y Select no
 * dupliquen clases. La altura sale de la capa de densidad por tamaño (ADR-0015);
 * en WEB los controles comparten 32/36/40 con Button porque el inventario real lo
 * confirma (NO se extrapola a móvil, que tiene su propia tabla en P1.4.4.5).
 *
 * Behavior-preserving: la base reproduce el `inputCls` histórico dominante
 * (rounded-md, border-strong, bg-surface, focus:ring). La tipografía/padding NO
 * se derivan por fórmula: se fijan al patrón dominante de formularios; los filtros
 * densos (sm/px-2/13px) se deciden en su migración, no acá.
 */
export type ControlSize = 'sm' | 'md' | 'lg';

/** Cáscara común (sin altura/tamaño/ancho ni estado). `focus:` (no focus-visible)
 *  preserva el anillo actual de los inputs, visible también con el mouse. */
const BASE = 'rounded-md border bg-surface outline-none focus:ring-2 focus:ring-brand';

/** Altura (var de densidad por tamaño) + padding + tipografía por tamaño. */
const SIZE: Record<ControlSize, string> = {
  sm: 'h-[var(--density-control-h-sm)] px-3 text-body',
  md: 'h-[var(--density-control-h-md)] px-3 text-input',
  lg: 'h-[var(--density-control-h-lg)] px-3 text-input',
};

/** Construye la clase del control. `className` se concatena al final (composición
 *  y layout: font-mono, márgenes, ancho; NO para redefinir tamaño/borde/estado). */
export function controlClass(size: ControlSize, invalid: boolean, fullWidth: boolean, className: string): string {
  return [BASE, SIZE[size], invalid ? 'border-danger' : 'border-strong', fullWidth ? 'w-full' : '', className]
    .filter(Boolean)
    .join(' ');
}
