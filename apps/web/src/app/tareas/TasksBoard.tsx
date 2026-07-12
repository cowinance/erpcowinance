'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSubmit, SubmitFeedback } from '@/components/capture';
import { Card, CardTitle } from '@/components/ui';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { Input } from '@/components/Input';
import { Select } from '@/components/Select';
import { formatDate } from '@/lib/format';

interface Task {
  id: string;
  title: string;
  description: string | null;
  type: string;
  due_date: string | null;
  priority: string;
  status: string;
  related_type: string | null;
  related_id: string | null;
  completed_at: string | null;
}

const PRIORITY_LABEL: Record<string, string> = { low: 'Baja', normal: 'Normal', high: 'Alta', urgent: 'Urgente' };
const GROUPS = [
  { key: 'overdue', label: 'Vencidas' },
  { key: 'today', label: 'Hoy' },
  { key: 'upcoming', label: 'Próximas' },
  { key: 'nodate', label: 'Sin fecha' },
] as const;

function urgency(due: string | null, today: string): 'overdue' | 'today' | 'upcoming' | 'nodate' {
  if (!due) return 'nodate';
  const d = due.slice(0, 10);
  if (d < today) return 'overdue';
  if (d === today) return 'today';
  return 'upcoming';
}

/** Lista de tareas con crear/completar/cancelar (online, REST). La web no es offline (D2). */
export function TasksBoard({ initialTasks }: { initialTasks: Task[] }) {
  const router = useRouter();
  const { state, message, submit } = useSubmit();
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [priority, setPriority] = useState('normal');

  const today = new Date().toISOString().slice(0, 10);
  const pending = initialTasks.filter((t) => t.status === 'pending');
  const closed = initialTasks.filter((t) => t.status === 'done' || t.status === 'canceled');

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    const res = await submit('/tasks', { title: title.trim(), due_date: due || null, priority }, () => 'Tarea creada');
    if (res) {
      setTitle('');
      setDue('');
      setPriority('normal');
      router.refresh();
    }
  }

  async function act(path: string) {
    const res = await submit(path, {}, () => 'Listo');
    if (res) router.refresh();
  }

  return (
    <div className="grid grid-cols-3 gap-4 max-lg:grid-cols-1">
      {/* Crear */}
      <Card>
        <CardTitle>Nueva tarea</CardTitle>
        <form onSubmit={create} className="space-y-3">
          <Field label="Título" htmlFor="task-title" required>
            <Input id="task-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Arreglar aguada…" required fullWidth />
          </Field>
          <Field label="Vencimiento" htmlFor="task-due">
            <Input id="task-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} fullWidth />
          </Field>
          <Field label="Prioridad" htmlFor="task-priority">
            <Select id="task-priority" value={priority} onChange={(e) => setPriority(e.target.value)} fullWidth>
              <option value="low">Baja</option>
              <option value="normal">Normal</option>
              <option value="high">Alta</option>
              <option value="urgent">Urgente</option>
            </Select>
          </Field>
          <Button type="submit" size="sm" loading={state === 'saving'} disabled={!title.trim()}>
            Agregar tarea
          </Button>
          <SubmitFeedback state={state} message={message} />
        </form>
      </Card>

      {/* Pendientes + cerradas */}
      <Card className="col-span-2 max-lg:col-span-1">
        <CardTitle>Pendientes</CardTitle>
        {!pending.length ? (
          <p className="py-6 text-center text-body text-ink-3">Sin tareas pendientes.</p>
        ) : (
          <div className="space-y-3">
            {GROUPS.map((g) => {
              const list = pending.filter((t) => urgency(t.due_date, today) === g.key);
              if (!list.length) return null;
              return (
                <div key={g.key}>
                  <div className="mb-1 text-caption font-medium tracking-[0.06em] text-ink-3 uppercase">
                    {g.label} · {list.length}
                  </div>
                  <div className="space-y-1.5">
                    {list.map((t) => {
                      const meta = [
                        t.type === 'health' ? 'Sanidad' : null,
                        t.priority !== 'normal' ? PRIORITY_LABEL[t.priority] : null,
                        t.due_date ? formatDate(t.due_date) : null,
                      ].filter(Boolean);
                      return (
                        <div key={t.id} className="flex items-center gap-3 rounded-md border border-subtle bg-sunken px-3 py-2">
                          <div className="min-w-0 flex-1">
                            <span className="text-body font-medium">{t.title}</span>
                            {meta.length ? <span className="ml-2 text-label text-ink-3">{meta.join(' · ')}</span> : null}
                          </div>
                          <Button variant="secondary" size="sm" onClick={() => act(`/tasks/${t.id}/complete`)}>
                            Completar
                          </Button>
                          <Button variant="secondary" size="sm" onClick={() => act(`/tasks/${t.id}/cancel`)}>
                            Cancelar
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {!!closed.length && (
          <div className="mt-4">
            <div className="mb-1 text-caption font-medium tracking-[0.06em] text-ink-3 uppercase">Cerradas · {closed.length}</div>
            <div className="space-y-1">
              {closed.slice(0, 20).map((t) => (
                <div key={t.id} className="flex items-center gap-3 px-3 py-1.5 text-body text-ink-3">
                  <span className="min-w-0 flex-1 truncate line-through">{t.title}</span>
                  <span className="text-label">{t.status === 'done' ? 'Completada' : 'Cancelada'}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
