import type { SelectHTMLAttributes, Ref } from 'react';
import { controlClass, type ControlSize } from './controlStyles';

/**
 * Primitivo Select (P1.4.4.2a). Misma cáscara que Input sobre un `<select>`
 * NATIVO (flecha del sistema; sin appearance-none), preservando el comportamiento
 * histórico. SOLO presentación: el catálogo de `<option>` lo provee el consumidor.
 *
 * - `controlSize` (sm/md/lg) → altura por densidad. Se llama `controlSize` para NO
 *   chocar con el atributo HTML nativo `size` (nº de filas), que queda disponible.
 * - `invalid` → `aria-invalid` + borde de error; un `aria-invalid` explícito del
 *   consumidor se respeta si `invalid` es falso.
 * - `ref` como prop (React 19) → `<select>` nativo.
 */
export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  controlSize?: ControlSize;
  invalid?: boolean;
  fullWidth?: boolean;
  ref?: Ref<HTMLSelectElement>;
}

export function Select({
  controlSize = 'md',
  invalid = false,
  fullWidth = true,
  className = '',
  'aria-invalid': ariaInvalid,
  children,
  ...rest
}: SelectProps) {
  return (
    <select
      {...rest}
      aria-invalid={invalid ? true : ariaInvalid}
      className={controlClass(controlSize, invalid, fullWidth, className)}
    >
      {children}
    </select>
  );
}
