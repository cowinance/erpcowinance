import { apiSafe } from '@/lib/server-api';
import { relativeTime } from '@/lib/format';
import { NotificationsFeed } from './NotificationsFeed';

/**
 * Notificaciones (P7-4.b): feed del ledger in_app por usuario, con marcado individual y
 * deep-link. Server Component para la carga inicial; la interacción vive en NotificationsFeed.
 * `apiSafe` devuelve null ante error y [] si está vacío → se distingue error de «sin novedades».
 * El texto relativo se calcula UNA vez en el servidor (evita hydration mismatch).
 */
export default async function NotificacionesPage() {
  const items = await apiSafe<any[]>('/notifications');
  const withTime = items?.map((n) => ({ ...n, relative: relativeTime(n.created_at) })) ?? null;
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold">Notificaciones</h1>
        <p className="mt-0.5 text-body text-ink-3">Tus novedades — retiros, vacunas, preñeces y tareas.</p>
      </div>
      <NotificationsFeed items={withTime} />
    </div>
  );
}
