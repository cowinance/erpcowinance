'use client';

import { useState } from 'react';
import { Check } from 'lucide-react';
import { UploadStep, type ImportBatch } from './UploadStep';

/**
 * Contenedor del asistente de importación (P2 P-e). Mantiene el paso activo y el
 * batch (id/estado/headers/mapping) como eje. En P-e.1 solo el paso «Subir» es
 * funcional; al subir, se avanza a un placeholder hasta que P-e.2 implemente el
 * mapeo.
 */
const STEPS = ['Subir', 'Mapear', 'Previsualizar', 'Confirmar', 'Resultado'] as const;

export function ImportWizard() {
  const [step, setStep] = useState(0);
  const [batch, setBatch] = useState<ImportBatch | null>(null);

  return (
    <div className="space-y-6">
      <Stepper current={step} />

      {step === 0 && (
        <UploadStep
          onUploaded={(b) => {
            setBatch(b);
            setStep(1);
          }}
        />
      )}

      {step > 0 && (
        <div className="rounded-[10px] border border-subtle bg-surface p-6 text-body text-ink-3 shadow-[var(--shadow-1)]">
          <p className="font-medium text-ink">
            Archivo cargado: <span className="font-mono">{batch?.source_filename ?? '—'}</span>
          </p>
          <p className="mt-1">
            {batch?.total_rows} filas · {batch?.headers.length} columnas detectadas.
          </p>
          <p className="mt-3">El paso «{STEPS[step]}» llega en la próxima entrega (P-e.2).</p>
        </div>
      )}
    </div>
  );
}

/** Cabecera de pasos. Local al import (no se promueve al DS todavía — YAGNI). */
function Stepper({ current }: { current: number }) {
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-1" aria-label="Progreso de importación">
      {STEPS.map((label, i) => {
        const state = i < current ? 'done' : i === current ? 'current' : 'todo';
        return (
          <li
            key={label}
            className="flex items-center gap-2"
            aria-current={state === 'current' ? 'step' : undefined}
            aria-disabled={state === 'todo' || undefined}
          >
            <span
              className={`inline-flex size-6 items-center justify-center rounded-full text-caption font-semibold ${
                state === 'done'
                  ? 'bg-brand text-white'
                  : state === 'current'
                    ? 'bg-brand-soft text-brand ring-1 ring-brand'
                    : 'bg-sunken text-ink-3'
              }`}
            >
              {state === 'done' ? <Check size={13} aria-hidden="true" /> : i + 1}
            </span>
            <span className={`text-label ${state === 'current' ? 'font-medium text-ink' : 'text-ink-3'}`}>{label}</span>
            {i < STEPS.length - 1 && <span className="mx-1 h-px w-6 bg-subtle" aria-hidden="true" />}
          </li>
        );
      })}
    </ol>
  );
}
