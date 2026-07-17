'use client';

/**
 * Tarjetas de problemas de calidad (A360 E6): cada tipo con su conteo, un enlace al listado
 * filtrado (cuando existe un filtro de E1 equivalente) y un desplegable con la muestra de
 * animales (link a la ficha). Export CSV del resumen.
 */
import { useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ChevronDown, Download, ExternalLink } from 'lucide-react';
import { downloadCsv } from '@/lib/csv';

export function QualityIssues({ issues }: { issues: any[] }) {
  const [open, setOpen] = useState<string | null>(null);

  const exportCsv = () => {
    downloadCsv('calidad-datos', [
      ['Problema', 'Cantidad'],
      ...issues.map((i) => [i.label, i.count]),
    ]);
  };

  return (
    <div>
      <div className="mb-3 flex justify-end">
        <button onClick={exportCsv} className="inline-flex items-center gap-1.5 text-label font-medium text-brand hover:underline">
          <Download size={14} /> Exportar resumen (CSV)
        </button>
      </div>
      <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
        {issues.map((i) => (
          <div key={i.code} className="rounded-[10px] border border-subtle bg-surface shadow-[var(--shadow-1)]">
            <div className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-2.5">
                <span className="flex size-8 items-center justify-center rounded-full bg-warning/10 text-warning">
                  <AlertTriangle size={15} />
                </span>
                <div>
                  <div className="text-body font-medium">{i.label}</div>
                  <div className="text-label text-ink-3">{i.count} animal{i.count === 1 ? '' : 'es'}</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {i.filter && (
                  <Link href={`/animales?${i.filter}`} className="inline-flex items-center gap-1 text-label font-medium text-brand hover:underline" title="Ver en el listado filtrado">
                    Ver <ExternalLink size={12} />
                  </Link>
                )}
                <button onClick={() => setOpen(open === i.code ? null : i.code)} className="text-ink-3 hover:text-ink" aria-label="Ver animales">
                  <ChevronDown size={16} className={open === i.code ? 'rotate-180 transition' : 'transition'} />
                </button>
              </div>
            </div>
            {open === i.code && (
              <div className="flex flex-wrap gap-1.5 border-t border-subtle px-4 py-3">
                {(i.animals ?? []).map((a: any) => (
                  <Link key={a.id} href={`/animales/${a.id}`} className="inline-flex h-7 items-center rounded-full border border-subtle bg-sunken px-2.5 font-mono text-label text-ink-2 hover:border-brand hover:text-brand">
                    {a.tag ?? a.id.slice(0, 6)}
                  </Link>
                ))}
                {i.count > (i.animals?.length ?? 0) && (
                  <span className="inline-flex h-7 items-center px-2 text-label text-ink-3">+{i.count - i.animals.length} más</span>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
