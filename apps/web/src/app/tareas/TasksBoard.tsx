'use client';

/**
 * Tablero operativo de Tareas (mejora a centro operativo, E2). Online (REST, D2): read-through
 * de /tasks/board + /tasks/kpis + /tasks/assignees. KPIs, buckets por urgencia, filtros
 * (búsqueda/prioridad/módulo/responsable) y acciones rápidas (Iniciar/Completar/Reprogramar/
 * Asignar/Cancelar) que reusan los endpoints del TaskService. No offline (eso es del móvil).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { API_URL, authHeaders } from '@/lib/api';
import { Card, CardTitle } from '@/components/ui';
import { Button } from '@/components/Button';
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
  related_name: string | null;
  assigned_to: string | null;
  assignee_name: string | null;
  completed_at: string | null;
  days_overdue: number | null;
  bucket: string;
}
interface Assignee { id: string; full_name: string; email: string }

const MODULE: Record<string, { label: string; cls: string }> = {
  health: { label: 'Sanidad', cls: 'bg-rose-500/15 text-rose-600 dark:text-rose-400' },
  breeding: { label: 'Reproducción', cls: 'bg-violet-500/15 text-violet-600 dark:text-violet-400' },
  feeding: { label: 'Alimentación', cls: 'bg-amber-500/15 text-amber-600 dark:text-amber-500' },
  maintenance: { label: 'Mantenimiento', cls: 'bg-slate-500/15 text-slate-600 dark:text-slate-300' },
  crop: { label: 'Cultivos', cls: 'bg-lime-500/15 text-lime-700 dark:text-lime-400' },
  general: { label: 'General', cls: 'bg-sky-500/15 text-sky-600 dark:text-sky-400' },
};
const PRIORITY: Record<string, { label: string; cls: string }> = {
  urgent: { label: 'Urgente', cls: 'bg-danger/15 text-danger' },
  high: { label: 'Alta', cls: 'bg-warning/15 text-warning' },
  normal: { label: 'Normal', cls: 'bg-ink-3/10 text-ink-2' },
  low: { label: 'Baja', cls: 'bg-ink-3/10 text-ink-3' },
};
const STATUS_LABEL: Record<string, string> = { pending: 'Pendiente', in_progress: 'En curso', done: 'Completada', canceled: 'Cancelada' };
const OPEN_BUCKETS = [
  { key: 'overdue', label: 'Vencidas' },
  { key: 'today', label: 'Hoy' },
  { key: 'next7', label: 'Próx. 7 días' },
  { key: 'month', label: 'Este mes' },
  { key: 'later', label: 'Más adelante' },
  { key: 'nodate', label: 'Sin fecha' },
] as const;
const CLOSED_TABS = [
  { key: 'done', label: 'Completadas' },
  { key: 'canceled', label: 'Canceladas' },
] as const;

export function TasksBoard() {
  const [tab, setTab] = useState<string>('today');
  const [q, setQ] = useState('');
  const [priority, setPriority] = useState('');
  const [type, setType] = useState('');
  const [assignee, setAssignee] = useState('');
  const [open, setOpen] = useState<Task[]>([]);
  const [closed, setClosed] = useState<Task[]>([]);
  const [kpis, setKpis] = useState<any>(null);
  const [assignees, setAssignees] = useState<Assignee[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const isClosedTab = tab === 'done' || tab === 'canceled';

  const qs = useCallback(
    (status: string) => {
      const p = new URLSearchParams({ status });
      if (q.trim()) p.set('q', q.trim());
      if (priority) p.set('priority', priority);
      if (type) p.set('type', type);
      if (assignee) p.set('assigned_to', assignee);
      return p.toString();
    },
    [q, priority, type, assignee],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [openRes, kpiRes] = await Promise.all([
        fetch(`${API_URL}/tasks/board?${qs('open')}`, { headers: authHeaders() }).then((r) => r.json()),
        fetch(`${API_URL}/tasks/kpis`, { headers: authHeaders() }).then((r) => r.json()),
      ]);
      setOpen(Array.isArray(openRes) ? openRes : []);
      setKpis(kpiRes);
      if (isClosedTab) {
        const c = await fetch(`${API_URL}/tasks/board?${qs(tab)}`, { headers: authHeaders() }).then((r) => r.json());
        setClosed(Array.isArray(c) ? c : []);
      }
    } finally {
      setLoading(false);
    }
  }, [qs, isClosedTab, tab]);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    fetch(`${API_URL}/tasks/assignees`, { headers: authHeaders() })
      .then((r) => r.json())
      .then((d) => setAssignees(Array.isArray(d) ? d : []))
      .catch(() => setAssignees([]));
  }, []);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const t of open) c[t.bucket] = (c[t.bucket] ?? 0) + 1;
    return c;
  }, [open]);

  const visible = isClosedTab ? closed : open.filter((t) => t.bucket === tab);

  async function action(url: string, body?: any) {
    setBusy(url);
    try {
      const res = await fetch(`${API_URL}${url}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders(), 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify(body ?? {}),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => null);
        alert(b?.message?.title ?? b?.title ?? 'Error');
        return;
      }
      await load();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      {kpis && <KpiRow kpis={kpis} />}

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar tarea…" className="h-8 w-56" />
        </div>
        <Select value={priority} onChange={(e) => setPriority(e.target.value)} controlSize="sm">
          <option value="">Toda prioridad</option>
          {Object.entries(PRIORITY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </Select>
        <Select value={type} onChange={(e) => setType(e.target.value)} controlSize="sm">
          <option value="">Todo módulo</option>
          {Object.entries(MODULE).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </Select>
        <Select value={assignee} onChange={(e) => setAssignee(e.target.value)} controlSize="sm">
          <option value="">Todos</option>
          <option value="me">Asignadas a mí</option>
          <option value="unassigned">Sin asignar</option>
          {assignees.map((a) => <option key={a.id} value={a.id}>{a.full_name}</option>)}
        </Select>
        <div className="ml-auto">
          <Button size="sm" onClick={() => setCreating((v) => !v)}>{creating ? 'Cerrar' : '+ Nueva tarea'}</Button>
        </div>
      </div>

      {creating && <CreateTask assignees={assignees} onCreated={() => { setCreating(false); load(); }} />}

      {/* Tabs / buckets */}
      <div className="flex flex-wrap gap-1.5 border-b border-subtle pb-2">
        {OPEN_BUCKETS.map((b) => (
          <TabBtn key={b.key} active={tab === b.key} onClick={() => setTab(b.key)} label={b.label} count={counts[b.key] ?? 0} danger={b.key === 'overdue'} />
        ))}
        {CLOSED_TABS.map((b) => (
          <TabBtn key={b.key} active={tab === b.key} onClick={() => setTab(b.key)} label={b.label} />
        ))}
      </div>

      {/* Lista */}
      {loading ? (
        <p className="py-10 text-center text-body text-ink-3">Cargando…</p>
      ) : visible.length === 0 ? (
        <p className="py-10 text-center text-body text-ink-3">Nada en esta vista.</p>
      ) : (
        <div className="space-y-2">
          {visible.map((t) => (
            <TaskCard key={t.id} task={t} busy={busy} assignees={assignees} onAction={action} />
          ))}
        </div>
      )}
    </div>
  );
}

function KpiRow({ kpis }: { kpis: any }) {
  const items = [
    { label: 'Vencidas', value: kpis.overdue, tone: kpis.overdue ? 'danger' : 'muted' },
    { label: 'Críticas vencidas', value: kpis.critical_overdue, tone: kpis.critical_overdue ? 'danger' : 'muted' },
    { label: 'Abiertas', value: kpis.open, tone: 'muted' },
    { label: 'Completadas hoy', value: kpis.done_today, tone: 'ok' },
    { label: 'Cumplimiento', value: kpis.compliance_pct != null ? `${kpis.compliance_pct}%` : '—', tone: kpis.compliance_pct != null && kpis.compliance_pct >= 70 ? 'ok' : 'warning' },
    { label: 'Atraso prom.', value: kpis.avg_delay_days != null ? `${kpis.avg_delay_days} d` : '—', tone: 'muted' },
  ];
  return (
    <div className="grid grid-cols-6 gap-3 max-md:grid-cols-3 max-sm:grid-cols-2">
      {items.map((i) => (
        <Card key={i.label} className="px-3 py-2.5">
          <div className={`tnum text-compat-24 font-semibold ${i.tone === 'danger' ? 'text-danger' : i.tone === 'ok' ? 'text-success' : i.tone === 'warning' ? 'text-warning' : 'text-ink'}`}>{i.value}</div>
          <div className="mt-0.5 text-caption text-ink-3">{i.label}</div>
        </Card>
      ))}
    </div>
  );
}

function TabBtn({ active, onClick, label, count, danger }: { active: boolean; onClick: () => void; label: string; count?: number; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-label font-medium ${active ? 'bg-brand text-white' : 'text-ink-2 hover:bg-sunken'}`}
    >
      {label}
      {count != null && count > 0 && (
        <span className={`tnum rounded-full px-1.5 text-caption ${active ? 'bg-white/20' : danger ? 'bg-danger/15 text-danger' : 'bg-ink-3/15 text-ink-2'}`}>{count}</span>
      )}
    </button>
  );
}

function TaskCard({ task, busy, assignees, onAction }: { task: Task; busy: string | null; assignees: Assignee[]; onAction: (url: string, body?: any) => void }) {
  const [expand, setExpand] = useState(false);
  const [newDue, setNewDue] = useState(task.due_date?.slice(0, 10) ?? '');
  const [reason, setReason] = useState('');
  const mod = MODULE[task.type] ?? MODULE.general;
  const pr = PRIORITY[task.priority] ?? PRIORITY.normal;
  const isOpen = task.status === 'pending' || task.status === 'in_progress';

  return (
    <div className="rounded-[10px] border border-subtle bg-surface px-4 py-3 shadow-[var(--shadow-1)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium text-ink">{task.title}</span>
            {task.status === 'in_progress' && <span className="rounded-full bg-info/15 px-2 py-0.5 text-caption font-medium text-info">En curso</span>}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-label text-ink-3">
            <span className={`rounded-full px-2 py-0.5 text-caption font-medium ${mod.cls}`}>{mod.label}</span>
            <span className={`rounded-full px-2 py-0.5 text-caption font-medium ${pr.cls}`}>{pr.label}</span>
            {task.due_date && <span>{formatDate(task.due_date)}</span>}
            {task.days_overdue != null && <span className="font-medium text-danger">· {task.days_overdue} d vencida</span>}
            {task.related_name && <span>· {task.related_type === 'animal' ? '🐄' : task.related_type === 'lot' ? '🔖' : '📍'} {task.related_name}</span>}
            {task.assignee_name && <span>· 👤 {task.assignee_name}</span>}
            {!task.assignee_name && isOpen && <span className="italic">· sin asignar</span>}
          </div>
          {task.description && <p className="mt-1 line-clamp-1 text-label text-ink-3">{task.description}</p>}
        </div>
        {isOpen && (
          <div className="flex shrink-0 items-center gap-1.5">
            {task.status === 'pending' && (
              <button onClick={() => onAction(`/tasks/${task.id}/start`)} disabled={!!busy} className="h-8 rounded-md border border-strong px-2.5 text-label font-medium text-ink-2 hover:bg-sunken">Iniciar</button>
            )}
            <button onClick={() => onAction(`/tasks/${task.id}/complete`)} disabled={!!busy} className="h-8 rounded-md bg-success px-2.5 text-label font-medium text-white hover:opacity-90">Completar</button>
            <button onClick={() => setExpand((v) => !v)} className="h-8 rounded-md border border-strong px-2 text-label text-ink-2 hover:bg-sunken">⋯</button>
          </div>
        )}
      </div>

      {expand && isOpen && (
        <div className="mt-3 flex flex-wrap items-end gap-3 border-t border-subtle pt-3">
          <div>
            <label className="mb-1 block text-caption text-ink-3">Reprogramar</label>
            <div className="flex items-center gap-1.5">
              <Input type="date" value={newDue} onChange={(e) => setNewDue(e.target.value)} className="h-8 w-40" />
              <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="motivo" className="h-8 w-32" />
              <button onClick={() => onAction(`/tasks/${task.id}/reschedule`, { due_date: newDue || null, reason: reason || null })} disabled={!!busy} className="h-8 rounded-md border border-strong px-2.5 text-label font-medium text-ink-2 hover:bg-sunken">Guardar</button>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-caption text-ink-3">Responsable</label>
            <Select value={task.assigned_to ?? ''} onChange={(e) => onAction(`/tasks/${task.id}/assign`, { assigned_to: e.target.value || null })} controlSize="sm">
              <option value="">Sin asignar</option>
              {assignees.map((a) => <option key={a.id} value={a.id}>{a.full_name}</option>)}
            </Select>
          </div>
          <button onClick={() => { if (confirm('¿Cancelar esta tarea?')) onAction(`/tasks/${task.id}/cancel`, { reason: reason || null }); }} disabled={!!busy} className="ml-auto h-8 self-end rounded-md border border-danger/40 px-2.5 text-label font-medium text-danger hover:bg-danger/10">Cancelar tarea</button>
        </div>
      )}
    </div>
  );
}

function CreateTask({ assignees, onCreated }: { assignees: Assignee[]; onCreated: () => void }) {
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [priority, setPriority] = useState('normal');
  const [type, setType] = useState('general');
  const [assignedTo, setAssignedTo] = useState('');
  const [saving, setSaving] = useState(false);

  async function create() {
    if (!title.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`${API_URL}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders(), 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({ title: title.trim(), due_date: due || null, priority, type }),
      });
      if (!res.ok) { const b = await res.json().catch(() => null); alert(b?.message?.title ?? 'Error'); return; }
      const { id } = await res.json();
      if (assignedTo && id) {
        await fetch(`${API_URL}/tasks/${id}/assign`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ assigned_to: assignedTo }) });
      }
      onCreated();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardTitle>Nueva tarea</CardTitle>
      <div className="grid grid-cols-6 gap-3 max-md:grid-cols-2">
        <div className="col-span-2 max-md:col-span-2">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Título…" fullWidth />
        </div>
        <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        <Select value={type} onChange={(e) => setType(e.target.value)}>
          {Object.entries(MODULE).filter(([k]) => k !== 'health').map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </Select>
        <Select value={priority} onChange={(e) => setPriority(e.target.value)}>
          {Object.entries(PRIORITY).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </Select>
        <Select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>
          <option value="">Sin asignar</option>
          {assignees.map((a) => <option key={a.id} value={a.id}>{a.full_name}</option>)}
        </Select>
      </div>
      <div className="mt-3">
        <Button size="sm" onClick={create} loading={saving} disabled={!title.trim()}>Crear tarea</Button>
      </div>
    </Card>
  );
}
