'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { API_URL, authHeaders } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { Card } from '@/components/ui';
import { Button } from '@/components/Button';
import { Bell, PawPrint, CheckSquare, ArrowRight } from 'lucide-react';

interface Item {
  id: string;
  title: string;
  body: string | null;
  status: string;
  read_at: string | null;
  created_at: string;
  related_type: string | null;
  related_id: string | null;
  relative: string;
}

/** Deep-link CERRADO: mapa fijo por related_type; encodeURIComponent al id; nunca desde title/body. */
function deepLink(relatedType: string | null, relatedId: string | null): string | null {
  if (!relatedId) return null;
  const id = encodeURIComponent(relatedId);
  switch (relatedType) {
    case 'animal':
      return `/animales/${id}`;
    case 'task':
      return `/tareas`;
    default:
      return null;
  }
}

function itemIcon(relatedType: string | null) {
  if (relatedType === 'animal') return PawPrint;
  if (relatedType === 'task') return CheckSquare;
  return Bell;
}

export function NotificationsFeed({ items }: { items: Item[] | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [read, setRead] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');

  // Error de carga (apiSafe → null): distinto de «lista vacía».
  if (items === null) {
    return (
      <Card>
        <p className="py-6 text-center text-body text-ink-2">No se pudieron cargar las notificaciones.</p>
        <div className="flex justify-center">
          <Button size="sm" onClick={() => router.refresh()}>
            Reintentar
          </Button>
        </div>
      </Card>
    );
  }
  if (items.length === 0) {
    return (
      <Card>
        <p className="py-8 text-center text-body text-success font-medium">Sin novedades ✓</p>
      </Card>
    );
  }

  const isRead = (n: Item) => n.status === 'read' || !!n.read_at || read.has(n.id);

  async function open(n: Item) {
    if (busy) return; // evita doble clic
    setError('');
    setBusy(n.id);
    setRead((s) => new Set(s).add(n.id)); // optimista
    try {
      const res = await fetch(`${API_URL}/notifications/${n.id}/read`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() } });
      if (!res.ok) throw new Error(`read ${res.status}`);
      const href = deepLink(n.related_type, n.related_id);
      if (href) {
        router.push(href); // navega; refresca la ruta destino (badge del layout)
        router.refresh();
      } else {
        router.refresh(); // sin destino: permanece en el feed, refresca badge + lista
      }
    } catch {
      setRead((s) => {
        const next = new Set(s);
        next.delete(n.id); // restaura visualmente el no leído
        return next;
      });
      setError('No se pudo marcar como leída. Reintentá.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      {!!error && (
        <p role="alert" className="mb-3 text-label text-danger">
          {error}
        </p>
      )}
      <div className="space-y-1">
        {items.map((n) => {
          const Icon = itemIcon(n.related_type);
          const unread = !isRead(n);
          const hasLink = !!deepLink(n.related_type, n.related_id);
          return (
            <button
              key={n.id}
              type="button"
              onClick={() => open(n)}
              disabled={busy === n.id}
              aria-label={`${unread ? 'No leída. ' : ''}${n.title}`}
              className={`flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left hover:bg-sunken disabled:opacity-60 ${unread ? 'bg-brand-soft' : ''}`}
            >
              {unread ? <span aria-hidden className="size-2 shrink-0 rounded-full bg-brand" /> : <span aria-hidden className="size-2 shrink-0" />}
              <Icon size={16} strokeWidth={1.75} className="shrink-0 text-ink-3" />
              <div className="min-w-0 flex-1">
                <div className={`truncate text-body ${unread ? 'font-semibold text-ink' : 'text-ink-2'}`}>{n.title}</div>
                {n.body ? <div className="truncate text-label text-ink-3">{n.body}</div> : null}
              </div>
              <time dateTime={n.created_at} title={formatDate(n.created_at)} className="shrink-0 text-label text-ink-3">
                {n.relative}
              </time>
              {hasLink ? <ArrowRight size={14} className="shrink-0 text-ink-3" /> : null}
            </button>
          );
        })}
      </div>
    </Card>
  );
}
