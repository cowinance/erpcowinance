import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { cookies } from 'next/headers';
import './globals.css';
import { Sidebar } from '@/components/Sidebar';
import { API_URL } from '@/lib/api';
import { ACCESS_COOKIE } from '@/lib/session';

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
  const session = await sessionContext();
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
            <div className="mx-auto max-w-[1440px] px-8 py-6">{children}</div>
          </main>
        </div>
      </body>
    </html>
  );
}
