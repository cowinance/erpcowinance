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

  return puede('user.block') ? (
    <AccionCuenta
      etiqueta="Bloquear"
      titulo="Bloquear al usuario"
      descripcion="Deja de poder iniciar sesión y se cierran sus sesiones activas. Es reversible."
      objetivo={objetivo}
      tono="peligro"
      accion={(motivo) => bloquearUsuario(id, motivo)}
    />
  ) : null;
}
