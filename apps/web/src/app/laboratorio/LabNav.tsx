'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS: [string, string][] = [
  ['/laboratorio', 'Muestras'],
  ['/laboratorio/laboratorios', 'Laboratorios'],
];

/** Navegación local del módulo Laboratorio. Sigue el patrón de TraceabilityNav/RrhhNav. */
export function LabNav() {
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
