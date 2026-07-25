'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS: [string, string][] = [
  ['/comercial', 'Socios'],
  ['/comercial/compras', 'Compras'],
  ['/comercial/ventas', 'Ventas'],
  ['/comercial/crm', 'CRM'],
];

/** Navegación local del módulo comercial (4 subrutas). Sigue el patrón de enlaces de la app. */
export function CommerceNav() {
  const pathname = usePathname();
  return (
    <nav className="tab-strip flex gap-1 border-b border-subtle">
      {TABS.map(([href, label]) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            className={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-body font-medium ${active ? 'border-brand text-brand' : 'border-transparent text-ink-3 hover:text-ink-1'}`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
