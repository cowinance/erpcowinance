import Link from 'next/link';
import { formatDay } from '@/lib/admin-api';

export interface Atencion {
  expiring_total: number;
  expiring: { id: string; name: string; plan_code: string | null; dias_para_vencer: number; current_period_end: string }[];
  idle_total: number;
  idle: { id: string; name: string; last_login_at: string | null; animals: number }[];
  over_limit_total: number;
  over_limit: {
    id: string;
    name: string;
    plan_code: string | null;
    animals: number;
    max_animals: number | null;
    users: number;
    max_users: number | null;
  }[];
}

/**
 * A QUIÉN LLAMAR HOY.
 *
 * El resumen eran ocho contadores correctos y ninguno accionable: decían cuántas cuentas hay, no
 * cuál necesita algo. Estos tres grupos son las tres formas de perder plata que el panel puede ver
 * —una prueba que nadie convierte, una cuenta que dejó de entrar, una que ya no entra en su plan— y
 * cada tarjeta lleva al listado con el MISMO filtro aplicado, para pasar de mirar a trabajar.
 *
 * Si no hay nada que atender, el bloque **no se dibuja**. Tres tarjetas en cero ocupando la parte
 * de arriba entrenan a ignorar el lugar donde después aparece algo urgente.
 */
export function BloqueAtencion({ a }: { a: Atencion }) {
  const hayAlgo = (a.expiring_total ?? 0) + (a.idle_total ?? 0) + (a.over_limit_total ?? 0) > 0;
  if (!hayAlgo) return null;

  return (
    <div className="mb-6">
      <h2 className="mb-2 text-subheading font-semibold">Atención</h2>
      <div className="grid gap-3 lg:grid-cols-3">
        <Tarjeta
          titulo="Períodos por vencer"
          total={a.expiring_total}
          hint="en los próximos 7 días"
          href="/admin/organizaciones?expiring=7"
          tono="warning"
          vacia="Ninguno vence esta semana"
        >
          {a.expiring.map((o) => (
            <Fila key={o.id} id={o.id} nombre={o.name}>
              {o.dias_para_vencer < 0
                ? `vencido hace ${Math.abs(o.dias_para_vencer)} d`
                : o.dias_para_vencer === 0
                  ? 'vence hoy'
                  : `en ${o.dias_para_vencer} d`}
              {o.plan_code ? ` · ${o.plan_code}` : ''} · {formatDay(o.current_period_end)}
            </Fila>
          ))}
        </Tarjeta>

        <Tarjeta
          titulo="Sin actividad"
          total={a.idle_total}
          hint="nadie ingresó hace 30 días o más"
          href="/admin/organizaciones?idle=30"
          tono="danger"
          vacia="Todas ingresaron este mes"
        >
          {a.idle.map((o) => (
            <Fila key={o.id} id={o.id} nombre={o.name}>
              {/* «Nunca» es distinto de «hace mucho»: una cuenta que se registró y no volvió es un
                  problema de onboarding, no de retención. */}
              {o.last_login_at ? `último ingreso ${formatDay(o.last_login_at)}` : 'nunca ingresó'}
              {o.animals > 0 ? ` · ${o.animals.toLocaleString('es')} animales` : ''}
            </Fila>
          ))}
        </Tarjeta>

        <Tarjeta
          titulo="Sobre el límite del plan"
          total={a.over_limit_total}
          hint="oportunidad de cambio de plan"
          href="/admin/organizaciones?over_limit=1"
          tono="info"
          vacia="Ninguna llegó a su tope"
        >
          {a.over_limit.map((o) => (
            <Fila key={o.id} id={o.id} nombre={o.name}>
              {o.max_animals !== null && o.animals >= o.max_animals
                ? `${o.animals.toLocaleString('es')} de ${o.max_animals.toLocaleString('es')} animales`
                : `${o.users} de ${o.max_users} usuarios`}
              {o.plan_code ? ` · ${o.plan_code}` : ''}
            </Fila>
          ))}
        </Tarjeta>
      </div>
    </div>
  );
}

const TONO: Record<string, string> = {
  warning: 'border-warning/40 bg-warning/5',
  danger: 'border-danger/40 bg-danger/5',
  info: 'border-info/40 bg-info/5',
};

function Tarjeta({
  titulo,
  total,
  hint,
  href,
  tono,
  vacia,
  children,
}: {
  titulo: string;
  total: number;
  hint: string;
  href: string;
  tono: 'warning' | 'danger' | 'info';
  vacia: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`rounded-[10px] border p-4 ${TONO[tono]}`}>
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-label font-medium">{titulo}</div>
        <div className="tnum text-heading font-semibold">{total ?? 0}</div>
      </div>
      <div className="text-caption text-ink-3">{hint}</div>
      <div className="mt-2 space-y-1">{total > 0 ? children : <div className="text-caption text-ink-3">{vacia}</div>}</div>
      {total > 0 && (
        <Link href={href} className="mt-3 inline-block text-label font-medium text-brand hover:underline">
          Ver las {total} →
        </Link>
      )}
    </div>
  );
}

function Fila({ id, nombre, children }: { id: string; nombre: string; children: React.ReactNode }) {
  return (
    <div className="text-label">
      <Link href={`/admin/organizaciones/${id}`} className="font-medium hover:underline">
        {nombre}
      </Link>
      <span className="text-ink-3"> — {children}</span>
    </div>
  );
}
