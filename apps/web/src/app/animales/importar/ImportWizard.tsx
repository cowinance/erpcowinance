'use client';

import { useState } from 'react';
import { Check } from 'lucide-react';
import { UploadStep, type ImportBatch } from './UploadStep';
import { MappingStep } from './MappingStep';
import { PreviewStep, type PreviewCounts } from './PreviewStep';
import { ConfirmStep } from './ConfirmStep';
import { ResultStep } from './ResultStep';

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
  const [counts, setCounts] = useState<PreviewCounts | null>(null);

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

      {step === 1 && batch && (
        <MappingStep
          batch={batch}
          onMapped={(b) => {
            setBatch(b);
            setStep(2);
          }}
          onBack={() => setStep(0)}
        />
      )}

      {step === 2 && batch && (
        <PreviewStep
          batch={batch}
          onConfirm={(c) => {
            setCounts(c);
            setStep(3);
          }}
          onBack={() => setStep(1)}
        />
      )}

      {step === 3 && batch && counts && (
        <ConfirmStep batch={batch} counts={counts} onCommitted={() => setStep(4)} onBack={() => setStep(2)} />
      )}

      {step === 4 && batch && (
        <ResultStep
          batch={batch}
          onRestart={() => {
            setBatch(null);
            setCounts(null);
            setStep(0);
          }}
        />
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
