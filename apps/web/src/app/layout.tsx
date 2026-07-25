import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { cookies, headers } from 'next/headers';
import './globals.css';
import { Sidebar } from '@/components/Sidebar';
import { MobileNav } from '@/components/MobileNav';
import { API_URL } from '@/lib/api';
import { ACCESS_COOKIE } from '@/lib/session';
import { PATHNAME_HEADER, isPublicRoute } from '@/lib/routes';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

export const metadata: Metadata = {
  title: 'Cowinance',
  description: 'Plataforma ERP para ganadería, agricultura y administración de fincas',
};

async function sessionContext() {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) return null;
  try {
    const headers = { Authorization: `Bearer ${token}` };
    // /alerts/kpis evalúa las reglas (read-through) → el badge siempre está fresco
    // /notifications/unread-count es READ-THROUGH (genera el ledger si falta) → el badge es
    // correcto en cualquier página sin descargar el feed, como /alerts/kpis con las alertas.
    const [me, farms, alertKpis, unread, flags] = await Promise.all([
      fetch(`${API_URL}/auth/me`, { headers, cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)),
      fetch(`${API_URL}/farms`, { headers, cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)),
      fetch(`${API_URL}/alerts/kpis`, { headers, cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)),
      fetch(`${API_URL}/notifications/unread-count`, { headers, cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)),
      fetch(`${API_URL}/config/feature-flags`, { headers, cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)),
    ]);
    if (!me) return null;
    const moduleFlags: Record<string, boolean> = {};
    for (const f of (flags ?? []) as { key: string; enabled: boolean }[]) moduleFlags[f.key] = f.enabled;
    return {
      userName: me.name as string,
      orgName: me.organization?.name as string,
      farmName: farms?.[0]?.name as string,
      openAlerts: (alertKpis?.open ?? 0) as number,
      criticalAlerts: (alertKpis?.critical ?? 0) as number,
      unreadNotifications: (unread?.count ?? 0) as number,
      moduleFlags,
    };
  } catch {
    return null;
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Registro, login y recuperación de contraseña NO son parte de la app: quien está ahí todavía no
  // tiene finca, así que un menú de módulos al costado no le ofrece nada y le sugiere que se está
  // perdiendo algo. `/login` lo venía tapando con un `fixed inset-0`; `/register` no, y por eso el
  // menú vacío aparecía al lado del formulario. Se corrige acá —donde se dibuja— en vez de agregar
  // otro parche por pantalla.
  const pathname = (await headers()).get(PATHNAME_HEADER) ?? '';
  const publica = isPublicRoute(pathname);

  // En una ruta pública tampoco se piden los datos de sesión: son cinco llamadas a la API que no
  // pueden devolver nada útil sin cookie.
  const session = publica ? null : await sessionContext();

  if (publica)
    return (
      <html lang="es" data-density="standard" className={inter.variable}>
        <body className="font-sans text-[14px] leading-5">{children}</body>
      </html>
    );

  return (
    <html lang="es" data-density="standard" className={inter.variable}>
      <body className="font-sans text-[14px] leading-5">
        <div className="flex min-h-screen">
          <Sidebar
            orgName={session?.orgName}
            farmName={session?.farmName}
            userName={session?.userName}
            openAlerts={session?.openAlerts ?? 0}
            criticalAlerts={session?.criticalAlerts ?? 0}
            unreadNotifications={session?.unreadNotifications ?? 0}
            moduleFlags={session?.moduleFlags ?? {}}
          />
          <main className="min-w-0 flex-1">
            {/* pb en móvil: la barra inferior es `fixed`, así que sin este espacio taparía el
                último elemento de cada pantalla — justo el botón de guardar en los formularios
                largos. Desaparece en lg, donde la barra no existe. */}
            <div className="mx-auto max-w-[1440px] px-8 py-6 max-lg:px-4 max-lg:pb-24">{children}</div>
          </main>
        </div>
        <MobileNav
          orgName={session?.orgName}
          farmName={session?.farmName}
          userName={session?.userName}
          openAlerts={session?.openAlerts ?? 0}
          criticalAlerts={session?.criticalAlerts ?? 0}
          unreadNotifications={session?.unreadNotifications ?? 0}
          moduleFlags={session?.moduleFlags ?? {}}
        />
      </body>
    </html>
  );
}
