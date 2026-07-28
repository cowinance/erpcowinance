import Link from 'next/link';
import { Check } from 'lucide-react';

export interface SetupStep {
  code: string;
  done: boolean;
  title: string;
  body: string;
  href: string;
  action: string;
  altHref?: string;
  altAction?: string;
}

export interface Setup {
  steps: SetupStep[];
  done: number;
  total: number;
  complete: boolean;
  next: string | null;
}

/**
 * Primeros pasos de la finca (O-2), derivados del estado real.
 *
 * Reemplaza a la guía anterior, que era una FOTO: tres pasos que no se tildaban nunca y que
 * desaparecían enteros al cargar el primer animal — justo cuando el productor todavía no tenía
 * lotes, ni un pesaje, ni una sanidad, y la app no podía decirle nada útil porque no había de dónde.
 *
 * Dos formas según cuánto falte, porque no es lo mismo una finca vacía que una a medio armar:
 *  - **hato vacío** → la tarjeta ES la pantalla: no hay KPIs que mostrar y fingirlos sería peor;
 *  - **algo cargado** → una tira compacta arriba del panel, que no le roba la pantalla al trabajo
 *    del día pero sigue estando hasta que la finca esté lista.
 *
 * Se apaga sola: `complete` sale de que los datos existan, no de que alguien la haya cerrado.
 */
export function FarmSetup({ setup, greetingName, farmName }: { setup: Setup; greetingName?: string; farmName?: string }) {
  if (setup.complete) return null;
  const vacia = setup.done === 0;
  const firstName = greetingName?.split(' ')[0];

  // El paso a resaltar es el PRIMERO pendiente: mandar al productor a pesar antes de tener animales
  // sería mandarlo a una pantalla donde no puede hacer nada.
  const siguiente = setup.steps.find((s) => s.code === setup.next);

  return (
    <div className={vacia ? '' : 'mb-6'}>
      {vacia && (
        <div className="mb-6">
          <h1 className="text-xl font-semibold">Bienvenido a Cowinance{firstName ? `, ${firstName}` : ''}</h1>
          <p className="mt-0.5 text-body text-ink-3">
            {farmName ? `${farmName} está lista` : 'Tu finca está lista'} — te faltan {setup.total} pasos para ponerla
            en marcha.
          </p>
        </div>
      )}

      <div className="rounded-[10px] border border-subtle bg-surface p-5 shadow-[var(--shadow-1)]">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-subheading font-semibold">Poné tu finca en marcha</h2>
          <span className="text-label text-ink-3" aria-label={`${setup.done} de ${setup.total} pasos completados`}>
            {setup.done} de {setup.total}
          </span>
        </div>

        {/* Barra de avance: decorativa — el conteo de al lado ya lo dice en texto. */}
        <div className="mb-5 h-1 w-full overflow-hidden rounded-full bg-sunken" aria-hidden="true">
          <div
            className="h-full rounded-full bg-brand transition-[width]"
            style={{ width: `${Math.round((setup.done / setup.total) * 100)}%` }}
          />
        </div>

        <ol className="space-y-3">
          {setup.steps.map((s, i) => {
            const esSiguiente = s.code === siguiente?.code;
            return (
              <li key={s.code} className="flex gap-3">
                <div
                  className={
                    'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-compat-10 font-semibold ' +
                    (s.done
                      ? 'bg-brand text-white'
                      : esSiguiente
                        ? 'bg-brand-soft text-brand'
                        : 'border border-subtle text-ink-3')
                  }
                >
                  {s.done ? <Check size={12} strokeWidth={3} /> : i + 1}
                </div>
                <div className="min-w-0 flex-1">
                  <div className={'text-body font-medium ' + (s.done ? 'text-ink-3 line-through' : '')}>{s.title}</div>
                  {/* El detalle y los botones solo en el que toca: los pendientes de más abajo se
                      enumeran para dar contexto, no para hacerse ahora. */}
                  {esSiguiente && (
                    <>
                      <p className="mt-0.5 text-label text-ink-3">{s.body}</p>
                      <div className="mt-2.5 flex flex-wrap gap-2">
                        <Link
                          href={s.href}
                          className="inline-flex h-8 items-center rounded-md bg-brand px-3 text-label font-medium text-white hover:opacity-90"
                        >
                          {s.action}
                        </Link>
                        {s.altHref && (
                          <Link
                            href={s.altHref}
                            className="inline-flex h-8 items-center rounded-md border border-subtle px-3 text-label font-medium hover:bg-brand-soft"
                          >
                            {s.altAction}
                          </Link>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
