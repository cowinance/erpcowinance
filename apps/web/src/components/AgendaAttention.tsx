import Link from 'next/link';
import { AlertTriangle, Syringe, Heart, PawPrint, CheckSquare, ArrowRight } from 'lucide-react';

/** Ítem de la agenda (P4), espejo del AgendaItemDto del servidor. */
interface AgendaItem {
  code: string;
  category: string;
  severity: 'info' | 'warning' | 'critical';
  due_at: string | null;
  title: string;
  message: string;
  related_type: string | null;
  related_id: string | null;
  tag: string | null;
  action: 'vaccinate' | 'review_pregnancy' | 'view_animal' | 'complete_task';
}

const GROUPS: { key: 'overdue' | 'today' | 'upcoming'; label: string }[] = [
  { key: 'overdue', label: 'Vencidos' },
  { key: 'today', label: 'Hoy' },
  { key: 'upcoming', label: 'Próximos' },
];

const ICON: Record<AgendaItem['action'], typeof AlertTriangle> = {
  vaccinate: Syringe,
  review_pregnancy: Heart,
  view_animal: PawPrint,
  complete_task: CheckSquare,
};

function urgency(item: AgendaItem, today: string): 'overdue' | 'today' | 'upcoming' {
  if (!item.due_at) return 'upcoming';
  const d = item.due_at.slice(0, 10);
  if (d < today) return 'overdue';
  if (d === today) return 'today';
  return 'upcoming';
}

/**
 * «Atención hoy» del dashboard (P4-4): la agenda diaria estructurada de `GET /agenda`,
 * agrupada por urgencia. Paridad con la sección «Hoy» del móvil, misma fuente. Los ítems
 * de animal enlazan a su ficha; los de tarea son informativos. Server-render (solo Links).
 */
export function AgendaAttention({ items }: { items: AgendaItem[] }) {
  if (!items.length) return <p className="py-6 text-center text-body text-ink-3">Todo en orden — sin pendientes hoy.</p>;

  const today = new Date().toISOString().slice(0, 10);
  const grouped = GROUPS.map((g) => ({ ...g, list: items.filter((i) => urgency(i, today) === g.key) })).filter((g) => g.list.length);

  return (
    <div className="space-y-3">
      {grouped.map((g) => (
        <div key={g.key}>
          <div className="mb-1 text-caption font-medium tracking-[0.06em] text-ink-3 uppercase">
            {g.label} · {g.list.length}
          </div>
          <div className="space-y-1.5">
            {g.list.map((i, idx) => {
              const Icon = ICON[i.action] ?? AlertTriangle;
              const warn = i.severity === 'warning' || i.severity === 'critical';
              const tappable = i.related_type === 'animal' && !!i.related_id;
              const cls = `flex items-center gap-3 rounded-md border-l-[3px] ${warn ? 'border-warning' : 'border-info'} bg-sunken px-3 py-2 ${tappable ? 'hover:bg-brand-soft' : ''}`;
              const body = (
                <>
                  <Icon size={16} strokeWidth={1.75} className={`shrink-0 ${warn ? 'text-warning' : 'text-info'}`} />
                  <div className="min-w-0 flex-1 text-body">
                    <span className="font-medium">{i.title}</span>
                    {i.message ? <span className="text-ink-3"> · {i.message}</span> : null}
                  </div>
                  {tappable ? <ArrowRight size={14} className="shrink-0 text-ink-3" /> : null}
                </>
              );
              const key = `${i.code}:${i.related_id ?? idx}`;
              return tappable ? (
                <Link key={key} href={`/animales/${i.related_id}`} className={cls}>
                  {body}
                </Link>
              ) : (
                <div key={key} className={cls}>
                  {body}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
