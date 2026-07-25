'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
// MISMOS íconos que el sidebar: dos juegos distintos para las mismas secciones se leen
// como dos aplicaciones.
import { Beef, CalendarCheck, LayoutDashboard, Menu, X, Zap } from 'lucide-react';
import { Sidebar } from './Sidebar';

/**
 * Navegación móvil de la web (no de la app nativa).
 *
 * **Por qué existe.** El sidebar es `max-lg:hidden` y NADA lo reemplazaba: por debajo de 1024 px la
 * app se quedaba sin navegación entera. Verificado pantalla por pantalla a 375 px — en `/animales`
 * y en la ficha de un animal había CERO enlaces al inicio. La única salida era el botón «atrás» del
 * navegador, que en el móvil se esconde al hacer scroll: había que raspar hacia arriba para que
 * reapareciera. De ahí que costara tanto salir de una pantalla.
 *
 * **Por qué barra abajo y no una hamburguesa arriba.** Volver al inicio queda en UN toque desde
 * donde sea, y en el lugar al que llega el pulgar de una mano. Arriba a la izquierda es el punto
 * más incómodo del teléfono, y con una hamburguesa volver al inicio serían dos toques.
 *
 * Los cinco accesos son los mismos de la app nativa, para que quien use las dos no aprenda dos
 * cosas. El resto de las secciones vive detrás de «Menú», que abre el sidebar COMPLETO como cajón —
 * la lista de módulos no se duplica.
 */

const TABS = [
  { href: '/', label: 'Inicio', icon: LayoutDashboard },
  { href: '/animales', label: 'Animales', icon: Beef },
  { href: '/manga', label: 'Manga', icon: Zap },
  { href: '/tareas', label: 'Tareas', icon: CalendarCheck },
] as const;

/**
 * Pantallas de trabajo a pantalla completa. La barra NO va: le roban altura a una interfaz pensada
 * para usarse con guantes y apuro, y ya tienen su propia salida («Salir» en manga). Sumar otro
 * control abajo es invitar al toque equivocado mientras pasa un animal.
 */
const FULLSCREEN = ['/manga'];

export function MobileNav(props: Parameters<typeof Sidebar>[0]) {
  const pathname = usePathname() ?? '/';
  const [open, setOpen] = useState(false);

  // El cajón se cierra al navegar: si quedara abierto, el usuario tocaría una sección y seguiría
  // viendo el menú encima de la pantalla que pidió.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Con el cajón abierto el fondo no debe desplazarse: en móvil, arrastrar sobre un panel abierto
  // mueve la página de atrás y al cerrar aparecés en otro punto del listado.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (FULLSCREEN.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return null;

  const activo = (href: string) => (href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`));

  return (
    <>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          {/* Tocar afuera cierra: es el gesto que la gente prueba primero. */}
          <button aria-label="Cerrar menú" onClick={() => setOpen(false)} className="absolute inset-0 bg-black/60" />
          <div className="absolute inset-y-0 left-0 flex w-[min(20rem,85vw)] flex-col bg-sunken shadow-xl">
            <div className="flex items-center justify-end px-2 pt-2">
              <button
                onClick={() => setOpen(false)}
                aria-label="Cerrar menú"
                className="flex size-10 items-center justify-center rounded-md text-ink-2 hover:bg-surface"
              >
                <X size={20} />
              </button>
            </div>
            <Sidebar {...props} variant="drawer" />
          </div>
        </div>
      )}

      <nav
        aria-label="Navegación principal"
        className="fixed inset-x-0 bottom-0 z-40 flex border-t border-subtle bg-surface lg:hidden"
        // Área segura de iOS: sin esto el indicador de inicio del iPhone se come la fila de botones.
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {TABS.map(({ href, label, icon: Icon }) => {
          const on = activo(href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={on ? 'page' : undefined}
              // min-h-14: objetivo de toque cómodo con guantes, no el mínimo de accesibilidad.
              className={`flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-caption ${
                on ? 'font-semibold text-brand' : 'text-ink-3'
              }`}
            >
              <Icon size={20} strokeWidth={on ? 2.25 : 1.75} />
              {label}
            </Link>
          );
        })}
        <button
          onClick={() => setOpen(true)}
          aria-label="Abrir menú"
          aria-expanded={open}
          className="flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-caption text-ink-3"
        >
          <Menu size={20} strokeWidth={1.75} />
          Menú
        </button>
      </nav>
    </>
  );
}
