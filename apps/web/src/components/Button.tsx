import type { ButtonHTMLAttributes } from 'react';

/**
 * Primitivo Button (P1.4.4.1c, ADR-0015). SOLO presentación + estado de
 * interacción: no conoce dominio ganadero, router, fetch, sesión ni copy.
 *
 * - Altura por `size` desde la capa de densidad: `--density-control-h-{sm,md,lg}`
 *   (modo `standard`: 32/36/40 = históricos h-8/h-9/h-10). `size` NUNCA se deriva
 *   por fórmula; la densidad seleccionará en el futuro la tabla del modo.
 * - `loading` añade `aria-busy` y bloquea la interacción; el texto visible lo
 *   sigue controlando el consumidor (no se añade spinner ni se cambia el copy).
 * - `className` es para composición/layout (margen, posición, necesidades
 *   locales); NO para redefinir variant/size/altura/color/estado. Es una regla de
 *   API y revisión — NO la garantiza automáticamente el orden de clases de Tailwind.
 */
export type ButtonVariant = 'primary' | 'secondary';
export type ButtonSize = 'sm' | 'md' | 'lg';

const BASE =
  'inline-flex items-center justify-center rounded-md font-medium disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand';

/** Altura (capa de densidad por tamaño) + tipografía histórica por tamaño. */
const SIZE: Record<ButtonSize, string> = {
  sm: 'h-[var(--density-control-h-sm)] text-body',
  md: 'h-[var(--density-control-h-md)] text-body',
  lg: 'h-[var(--density-control-h-lg)] text-input',
};

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-brand px-4 text-white hover:opacity-90',
  secondary: 'border border-strong px-3 text-ink-2 hover:bg-sunken',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  fullWidth?: boolean;
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  fullWidth = false,
  type = 'button',
  disabled,
  className = '',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`${BASE} ${SIZE[size]} ${VARIANT[variant]}${fullWidth ? ' w-full' : ''}${className ? ` ${className}` : ''}`}
    >
      {children}
    </button>
  );
}
