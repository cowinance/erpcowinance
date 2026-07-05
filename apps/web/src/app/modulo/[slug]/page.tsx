import Link from 'next/link';
import { MODULES } from '@/lib/modules';
import { Hammer, ArrowLeft } from 'lucide-react';

export default async function ModulePlaceholder({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const mod = MODULES[slug] ?? {
    name: slug,
    suite: '—',
    fase: '—',
    description: 'Módulo del catálogo Cowinance.',
  };

  return (
    <div className="flex min-h-[70vh] items-center justify-center">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-5 flex size-12 items-center justify-center rounded-lg bg-brand-soft">
          <Hammer size={22} className="text-brand" strokeWidth={1.75} />
        </div>
        <div className="mb-1 text-[11px] font-medium tracking-[0.06em] text-ink-3 uppercase">
          {mod.suite} · {mod.fase} del roadmap
        </div>
        <h1 className="text-xl font-semibold">{mod.name}</h1>
        <p className="mt-2 text-ink-2">{mod.description}</p>
        <p className="mt-4 text-[13px] text-ink-3">
          Este módulo forma parte del catálogo de 40 módulos y se construye de forma incremental según el roadmap.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex h-9 items-center gap-2 rounded-md bg-brand px-4 text-[13px] font-medium text-white"
        >
          <ArrowLeft size={15} /> Volver al inicio
        </Link>
      </div>
    </div>
  );
}
