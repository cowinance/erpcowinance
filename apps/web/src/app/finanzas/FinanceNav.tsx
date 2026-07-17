'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS: [string, string][] = [
  ['/finanzas', 'Plan de cuentas'],
  ['/finanzas/asientos', 'Asientos'],
  ['/finanzas/sumas-y-saldos', 'Sumas y saldos'],
  ['/finanzas/facturas', 'Facturas'],
  ['/finanzas/pagos', 'Pagos'],
  ['/finanzas/tesoreria', 'Tesorería'],
  ['/finanzas/presupuestos', 'Presupuestos'],
  ['/finanzas/config', 'Config'],
];

/** Navegación local del módulo Finanzas (F-4a). Sigue el patrón de CommerceNav. */
export function FinanceNav() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 border-b border-subtle">
      {TABS.map(([href, label]) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            className={`-mb-px border-b-2 px-3 py-2 text-body font-medium ${active ? 'border-brand text-brand' : 'border-transparent text-ink-3 hover:text-ink-1'}`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
