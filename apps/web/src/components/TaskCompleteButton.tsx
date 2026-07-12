'use client';

import { useRouter } from 'next/navigation';
import { useSubmit } from '@/components/capture';

/**
 * Botón «Completar» de una tarea en «Atención hoy» (P6-2.c). Isla cliente dentro del
 * server-render de AgendaAttention: completa online por REST (POST /tasks/:id/complete,
 * la regla única de TaskService sirve tareas de Sanidad y generales) y refresca la vista.
 */
export function TaskCompleteButton({ taskId }: { taskId: string }) {
  const router = useRouter();
  const { state, submit } = useSubmit();

  async function complete(e: React.MouseEvent) {
    e.preventDefault();
    const res = await submit(`/tasks/${taskId}/complete`, {}, () => 'Listo');
    if (res) router.refresh();
  }

  return (
    <button
      type="button"
      onClick={complete}
      disabled={state === 'saving'}
      className="shrink-0 rounded-md border border-subtle bg-surface px-2.5 py-1 text-label font-medium text-ink-2 hover:bg-brand-soft disabled:opacity-50"
    >
      Completar
    </button>
  );
}
