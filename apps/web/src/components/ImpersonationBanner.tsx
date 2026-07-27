'use client';

import { useState } from 'react';

/**
 * Franja de MODO ESPEJO. Se dibuja arriba de todo, fija, y en un color que no aparece en ninguna
 * otra parte de la app.
 *
 * ## Por qué es tan estridente
 *
 * El riesgo del modo espejo no es técnico —la transacción es de solo lectura, el motor no deja
 * escribir— sino humano: alguien de soporte con varias pestañas abiertas mirando la finca de un
 * cliente y creyendo que mira la suya. De ahí sale «le conté a un cliente algo de otro cliente».
 *
 * Por eso la franja dice las TRES cosas que hay que saber de un vistazo: de quién es la finca que
 * se está viendo, como qué usuario, y que no se puede modificar nada. Y por eso es `sticky` y
 * empuja el contenido en vez de flotar encima: una franja que se va con el scroll deja de existir
 * justo cuando la sesión se hace larga y uno se olvidó.
 */
export function ImpersonationBanner({
  orgName,
  userEmail,
  byEmail,
  sid,
}: {
  orgName?: string;
  userEmail?: string;
  byEmail: string;
  sid?: string;
}) {
  const [saliendo, setSaliendo] = useState(false);

  async function salir() {
    if (saliendo) return;
    setSaliendo(true);
    try {
      await fetch('/api/admin/impersonate/end', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sid }),
      });
    } catch {
      /* la cookie se limpia igual del lado del servidor; si falló la red, el token vence solo */
    }
    // Recarga completa y no `router.push`: hay que descartar TODO lo que quedó renderizado con los
    // datos del cliente, incluido lo que Next tenga cacheado del router.
    window.location.href = '/admin';
  }

  return (
    <div className="sticky top-0 z-50 flex flex-wrap items-center justify-between gap-2 border-b border-warning/40 bg-warning/15 px-4 py-2">
      <div className="text-label">
        <span className="font-semibold text-warning">MODO ESPEJO · solo lectura</span>
        <span className="text-ink-2">
          {' — '}estás viendo <span className="font-medium">{orgName ?? 'esta finca'}</span>
          {userEmail ? (
            <>
              {' '}como <span className="font-medium">{userEmail}</span>
            </>
          ) : null}
          . No podés modificar nada. Entraste como <span className="font-medium">{byEmail}</span>.
        </span>
      </div>
      <button
        type="button"
        onClick={salir}
        disabled={saliendo}
        className="h-7 shrink-0 rounded-md border border-warning/50 px-3 text-label font-medium text-warning disabled:opacity-50"
      >
        {saliendo ? 'Saliendo…' : 'Salir del modo espejo'}
      </button>
    </div>
  );
}
