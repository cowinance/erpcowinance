import Link from 'next/link';
import { headers } from 'next/headers';
import { cookies } from 'next/headers';
import { PATHNAME_HEADER, ADMIN_LOGIN_ROUTE } from '@/lib/routes';
import { PLATFORM_COOKIE } from '@/lib/admin-session';
import { adminApi } from '@/lib/admin-api';

/**
 * Shell del panel de plataforma. Deliberadamente distinto del de la app:
 *
 *  · Barra superior oscura, no el sidebar de módulos. La señal visual tiene que ser inmediata —
 *    quien está acá está mirando datos de TODOS los clientes, no de una finca. Confundir las dos
 *    pantallas es el error que precede a un «lo cambié en la cuenta equivocada».
 *  · Cuatro secciones y nada más. Un panel de administración es una herramienta de trabajo: se
 *    entra a resolver algo concreto y se sale.
 */
const NAV = [
  { href: '/admin', label: 'Resumen' },
  { href: '/admin/organizaciones', label: 'Organizaciones' },
  { href: '/admin/usuarios', label: 'Usuarios' },
  { href: '/admin/auditoria', label: 'Auditoría' },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = (await headers()).get(PATHNAME_HEADER) ?? '';
  // El login vive dentro de `/admin` pero no lleva shell: todavía no hay sesión que mostrar.
  if (pathname === ADMIN_LOGIN_ROUTE) return <>{children}</>;

  // Sin cookie el middleware ya redirigió; este chequeo cubre el render directo (build, prefetch)
  // sin disparar una llamada que sabemos que va a fallar.
  const haySesion = (await cookies()).get(PLATFORM_COOKIE)?.value;
  const actor = haySesion ? await adminApi<{ name: string; email: string; role: string }>('/me') : null;

  return (
    <div className="min-h-screen bg-canvas">
      {/* `bg-raised` y no un color suelto: el sistema de tokens NO define `ink-1`, y una clase
          inexistente en Tailwind no falla — simplemente no genera fondo. El encabezado quedaba
          transparente y el contenido se leía a través de él al scrollear, que es el peor lugar
          para un fallo silencioso: la barra es `sticky` y siempre está a la vista. */}
      <header className="sticky top-0 z-40 border-b border-strong bg-raised">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-6 gap-y-2 px-6 py-3">
          <Link href="/admin" className="flex items-center gap-2 font-semibold">
            <span className="flex size-7 items-center justify-center rounded-md bg-brand text-[13px] font-bold text-white">
              C
            </span>
            Cowinance · Plataforma
          </Link>
          <nav className="flex flex-wrap items-center gap-1">
            {NAV.map((item) => {
              const activo = item.href === '/admin' ? pathname === '/admin' : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`rounded-md px-3 py-1.5 text-body ${activo ? 'bg-brand/15 font-medium text-brand' : 'text-ink-2 hover:bg-sunken'}`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-label">
            {actor && (
              <span className="text-ink-2">
                {actor.name} · <span className="uppercase tracking-wide">{actor.role}</span>
              </span>
            )}
            <form action="/api/admin/logout" method="post">
              <button type="submit" className="rounded-md border border-subtle px-2.5 py-1 text-ink-2 hover:bg-sunken">
                Salir
              </button>
            </form>
          </div>
        </div>
      </header>
      {/* Aviso permanente y no descartable: la fase 1 es de solo lectura, y decirlo evita que
          alguien busque durante diez minutos el botón de suspender una cuenta. */}
      <div className="border-b border-subtle bg-warning/10 px-6 py-1.5 text-center text-caption text-ink-2">
        Panel en modo <strong>solo lectura</strong> · las acciones sobre cuentas llegan en la fase 2
      </div>
      <main className="mx-auto max-w-[1440px] px-6 py-6">{children}</main>
    </div>
  );
}
