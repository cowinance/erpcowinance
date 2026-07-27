'use client';

import { AccionCuenta } from '../AccionCuenta';
import { bloquearUsuario, desbloquearUsuario } from '../acciones';

/**
 * Bloquear / desbloquear desde el listado de usuarios (fase 2).
 *
 * Se ofrece SOLO la acción que corresponde al estado actual, igual que en organizaciones. Y en dos
 * casos no se ofrece ninguna, con el motivo a la vista en vez de un botón muerto:
 *
 *  · **Usuario eliminado** — desbloquearlo lo revivirá­a, que no es lo que el botón dice hacer.
 *  · **Tu propia cuenta** — bloquearte te deja afuera del panel sin nadie que te saque. El backend
 *    igual lo rechaza; acá se evita el viaje y, sobre todo, se explica por qué.
 */
export function AccionUsuario({
  id,
  nombre,
  email,
  estado,
  acciones,
  esMiCuenta,
}: {
  id: string;
  nombre: string;
  email: string;
  estado: string;
  acciones: string[];
  esMiCuenta: boolean;
}) {
  const puede = (a: string) => acciones.includes(a);
  const objetivo = `${nombre} · ${email}`;

  if (estado === 'deleted') return <span className="text-caption text-ink-3">Eliminado</span>;
  if (esMiCuenta) return <span className="text-caption text-ink-3">Tu cuenta</span>;

  const espejo = estado === 'active' && puede('user.impersonate') && (
    <AccionCuenta
      etiqueta="Entrar como"
      titulo="Entrar en modo espejo"
      descripcion={
        'Vas a ver la finca de este usuario como la ve él, en SOLO LECTURA y por 10 minutos. ' +
        'Ojo: esto cierra tu sesión del ERP si tenías una abierta.'
      }
      objetivo={objetivo}
      accion={(motivo) => entrarComoUsuario(id, motivo)}
    />
  );

  if (estado === 'blocked')
    return puede('user.unblock') ? (
      <AccionCuenta
        etiqueta="Desbloquear"
        titulo="Desbloquear al usuario"
        descripcion="Vuelve a poder iniciar sesión."
        objetivo={objetivo}
        accion={(motivo) => desbloquearUsuario(id, motivo)}
      />
    ) : null;

  return (
    <div className="flex flex-wrap items-start gap-2">
      {espejo}
      {puede('user.block') && (
        <AccionCuenta
          etiqueta="Bloquear"
          titulo="Bloquear al usuario"
          descripcion="Deja de poder iniciar sesión y se cierran sus sesiones activas. Es reversible."
          objetivo={objetivo}
          tono="peligro"
          accion={(motivo) => bloquearUsuario(id, motivo)}
        />
      )}
    </div>
  );
}

/**
 * Entrar en modo espejo NO es una Server Action como el resto.
 *
 * Las demás acciones sirven para que el servidor haga algo y la página se revalide. Ésta tiene que
 * **fijar cookies y después navegar**, y una Server Action que escribe cookies y redirige a otra
 * app es más frágil que un `fetch` a un route handler: acá el navegador recibe las cookies en la
 * respuesta y recién entonces cambiamos de página, con una recarga completa para no arrastrar nada
 * cacheado del panel.
 */
async function entrarComoUsuario(id: string, motivo: string) {
  const res = await fetch('/api/admin/impersonate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: id, reason: motivo }),
  });
  const cuerpo = await res.json().catch(() => null);
  if (!res.ok) return { ok: false as const, error: cuerpo?.title ?? 'No se pudo entrar en modo espejo' };
  window.location.href = '/';
  return { ok: true as const, mensaje: 'Entrando…' };
}
