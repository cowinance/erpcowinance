import Link from 'next/link';
import { Plus } from 'lucide-react';

/**
 * Estado vacío guiado del dashboard (P1.3.5): la finca existe pero el hato está
 * vacío (0 animales activos). Server Component puro — reemplaza los KPIs y el
 * "Todo en orden" engañosos cuando aún no hay información operativa. La guía solo
 * menciona acciones que ya existen (animal, pesaje/sanidad, historial); nada de
 * lotes, potreros, invitaciones ni fincas adicionales.
 */
export function EmptyFarmState({ greetingName, farmName }: { greetingName?: string; farmName?: string }) {
  const firstName = greetingName?.split(' ')[0];
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold">Bienvenido a Cowinance{firstName ? `, ${firstName}` : ''}</h1>
        <p className="mt-0.5 text-[13px] text-ink-3">
          {farmName ? `${farmName} está lista` : 'Tu finca está lista'} — todavía no cargaste animales.
        </p>
      </div>

      <div className="rounded-[10px] border border-subtle bg-surface p-8 text-center shadow-[var(--shadow-1)]">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-xl bg-brand-soft text-brand">
          <Plus size={22} />
        </div>
        <h2 className="text-[15px] font-semibold">Cargá tu primer animal</h2>
        <p className="mx-auto mt-1 max-w-md text-[13px] text-ink-3">
          Tu finca ya está creada, pero el hato está vacío. Registrá tu primer animal para empezar a ver
          KPIs, pesajes, sanidad y reproducción.
        </p>
        <Link
          href="/animales/nuevo"
          className="mt-5 inline-flex h-9 items-center gap-1.5 rounded-md bg-brand px-4 text-[13px] font-medium text-white hover:opacity-90"
        >
          <Plus size={15} /> Cargar primer animal
        </Link>

        <ol className="mx-auto mt-7 max-w-xs space-y-2 text-left text-[12px] text-ink-2">
          <li className="flex gap-2">
            <span className="font-semibold text-brand">1.</span> Cargá un animal con su caravana.
          </li>
          <li className="flex gap-2">
            <span className="font-semibold text-brand">2.</span> Registrá un pesaje o una vacunación desde su ficha.
          </li>
          <li className="flex gap-2">
            <span className="font-semibold text-brand">3.</span> Seguí su historial y los KPIs de tu finca.
          </li>
        </ol>
      </div>
    </div>
  );
}
