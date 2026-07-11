import type { InputHTMLAttributes, Ref } from 'react';
import { controlClass, type ControlSize } from './controlStyles';

/**
 * Primitivo Input (P1.4.4.2a). SOLO presentación + estado de interacción: no
 * conoce dominio, validación, catálogos, fetch, búsqueda ni formularios concretos.
 *
 * - `controlSize` (sm/md/lg) → altura por densidad (32/36/40 en `standard`). Se
 *   llama `controlSize` para NO chocar con el atributo HTML nativo `size` (ancho
 *   en caracteres), que queda disponible como prop estándar.
 * - `invalid` → `aria-invalid` + borde de error; NO valida ni decide obligatoriedad.
 *   Un `aria-invalid` explícito del consumidor se respeta si `invalid` es falso.
 * - `fullWidth` (default true): el ancho dominante de los formularios reales.
 * - Propaga props HTML estándar (incl. `aria-describedby`, `disabled`, `size`, `ref`).
 *   `ref` se acepta como prop (React 19) y apunta al `<input>` nativo.
 */
export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  controlSize?: ControlSize;
  invalid?: boolean;
  fullWidth?: boolean;
  ref?: Ref<HTMLInputElement>;
}

export function Input({
  controlSize = 'md',
  invalid = false,
  fullWidth = true,
  className = '',
  'aria-invalid': ariaInvalid,
  ...rest
}: InputProps) {
  return (
    <input
      {...rest}
      aria-invalid={invalid ? true : ariaInvalid}
      className={controlClass(controlSize, invalid, fullWidth, className)}
    />
  );
}
