'use client';

import { AccionCuenta } from '../../AccionCuenta';
import { cambiarPlan, reactivarOrganizacion, suspenderOrganizacion } from '../../acciones';

/**
 * Barra de acciones de una organización (fase 2).
 *
 * Las acciones que el rol NO puede ejecutar **no se dibujan**. La lista viene resuelta del servidor
 * (`GET /platform/me` → `actions`), así que el panel no repite la regla de permisos: si divergiera,
 * mostraría botones que terminan en 403 — o peor, escondería alguno que la persona sí podía usar.
 *
 * Suspender y reactivar son excluyentes: se ofrece la que corresponde al estado actual, no las dos
 * con una deshabilitada. Un botón inerte al lado del bueno es una invitación a apretar el que no va.
 */
export function AccionesOrganizacion({
  id,
  nombre,
  estado,
  planActual,
  acciones,
  planes,
}: {
  id: string;
  nombre: string;
  estado: string;
  planActual?: string;
  acciones: string[];
  planes: { code: string; name: string }[];
}) {
  const puede = (a: string) => acciones.includes(a);
  const suspendida = estado === 'suspended';
  const deBaja = estado === 'churned';

  // Sin ninguna acción disponible (auditor, o una cuenta dada de baja) no se dibuja la barra: un
  // recuadro vacío sugiere que algo no cargó.
  const hayAlgo =
    !deBaja && ((suspendida && puede('organization.reactivate')) || (!suspendida && puede('organization.suspend')) || puede('organization.change_plan'));
  if (!hayAlgo) return null;

  // El plan actual se saca de la lista: cambiar al mismo plan devolvería 409, así que ofrecerlo es
  // ofrecer un error.
  const disponibles = planes.filter((p) => p.code !== planActual);

  return (
    <div className="mb-6 flex flex-wrap items-start gap-3 rounded-[10px] border border-strong bg-raised p-4">
      <div className="mr-2 text-label text-ink-2">Acciones</div>

      {!suspendida && puede('organization.suspend') && (
        <AccionCuenta
          etiqueta="Suspender cuenta"
          titulo="Suspender la cuenta"
          descripcion="La finca deja de poder ingresar y se cierran sus sesiones activas. Es reversible."
          objetivo={nombre}
          tono="peligro"
          accion={(motivo) => suspenderOrganizacion(id, motivo)}
        />
      )}

      {suspendida && puede('organization.reactivate') && (
        <AccionCuenta
          etiqueta="Reactivar cuenta"
          titulo="Reactivar la cuenta"
          descripcion="La finca vuelve a poder ingresar. Sus usuarios tendrán que iniciar sesión de nuevo."
          objetivo={nombre}
          accion={(motivo) => reactivarOrganizacion(id, motivo)}
        />
      )}

      {puede('organization.change_plan') &&
        (disponibles.length === 0 ? null : (
          <AccionCuenta
            etiqueta="Cambiar plan"
            titulo="Cambiar el plan"
            descripcion="Cambia los límites de la cuenta. NO genera ningún cobro ni ajuste de facturación."
            objetivo={nombre}
            planes={disponibles}
            accion={(motivo, planCode) => cambiarPlan(id, planCode!, motivo)}
          />
        ))}
    </div>
  );
}
