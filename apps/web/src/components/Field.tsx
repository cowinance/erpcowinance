import type { ReactNode } from 'react';

/**
 * Primitivo Field (P1.4.4.2a). SOLO layout + textos de un campo: label, marca de
 * requerido, help y error, con ids ESTABLES derivados de `htmlFor`. NO ejecuta
 * validación, NO decide obligatoriedad, NO conoce dominio ni fetch.
 *
 * La asociación es EXPLÍCITA (sin cloneElement/Context/render-props): el consumidor
 * pasa el mismo `id={htmlFor}` al control y conecta `aria-describedby`/`aria-invalid`
 * a mano (usando `fieldDescribedBy`). Así queda visible en el JSX de dónde salen.
 */
export interface FieldProps {
  label?: ReactNode;
  htmlFor: string;
  help?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  children: ReactNode;
}

/** ids estables de los textos descriptivos de un campo. */
export const fieldHelpId = (htmlFor: string) => `${htmlFor}-help`;
export const fieldErrorId = (htmlFor: string) => `${htmlFor}-error`;

/** Helper PURO para `aria-describedby`: une los ids de help/error presentes. */
export function fieldDescribedBy(htmlFor: string, opts: { help?: boolean; error?: boolean }): string | undefined {
  const ids = [opts.help ? fieldHelpId(htmlFor) : '', opts.error ? fieldErrorId(htmlFor) : ''].filter(Boolean);
  return ids.length ? ids.join(' ') : undefined;
}

export function Field({ label, htmlFor, help, error, required, children }: FieldProps) {
  return (
    <div>
      {label != null && (
        <label htmlFor={htmlFor} className="mb-1 block text-label font-medium text-ink-2">
          {label}
          {required && <span aria-hidden="true"> *</span>}
        </label>
      )}
      {children}
      {help != null && (
        <p id={fieldHelpId(htmlFor)} className="mt-1 text-label text-ink-3">
          {help}
        </p>
      )}
      {error != null && (
        <p id={fieldErrorId(htmlFor)} role="alert" className="mt-1 text-label text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
