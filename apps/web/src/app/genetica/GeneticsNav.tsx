'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS: [string, string][] = [
  ['/genetica', 'Semen'],
  ['/genetica/embriones', 'Embriones'],
  ['/genetica/evaluaciones', 'Evaluaciones'],
];

/** Navegación local del módulo Genética (G-3). Sigue el patrón de CommerceNav/FinanceNav. */
export function GeneticsNav() {
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
