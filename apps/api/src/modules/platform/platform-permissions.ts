import type { PlatformRole } from './platform-session';

/**
 * Qué puede HACER cada rol de plataforma (fase 2).
 *
 * Los cuatro roles existían desde la fase 1 pero no significaban nada: todos leían lo mismo. Al
 * aparecer las escrituras tienen que separarse, y la línea no es «cuánto confiamos en la persona»
 * sino **de qué se ocupa**:
 *
 *  · `superadmin` — todo. Es el dueño del sistema.
 *  · `billing`    — lo COMERCIAL: suspender por falta de pago, reactivar al cobrar, cambiar el plan.
 *                   No toca usuarios: la mora es de la cuenta, no de la persona.
 *  · `support`    — lo OPERATIVO sobre personas: bloquear y desbloquear un usuario (abuso, cuenta
 *                   comprometida). No decide plata.
 *  · `auditor`    — mira y no toca. Existe para poder dar acceso de revisión sin dar poder.
 *
 * La regla vive acá, pura y en un solo lugar, por lo mismo que el resto de las reglas del sistema:
 * repartida por los handlers, cada endpoint nuevo es otra oportunidad de olvidarse un chequeo.
 */
export type PlatformAction =
  | 'organization.suspend'
  | 'organization.reactivate'
  | 'organization.change_plan'
  | 'user.block'
  | 'user.unblock';

const PERMISOS: Record<PlatformRole, readonly PlatformAction[]> = {
  superadmin: [
    'organization.suspend',
    'organization.reactivate',
    'organization.change_plan',
    'user.block',
    'user.unblock',
  ],
  billing: ['organization.suspend', 'organization.reactivate', 'organization.change_plan'],
  support: ['user.block', 'user.unblock'],
  auditor: [],
};

export function canPerform(role: PlatformRole, action: PlatformAction): boolean {
  return PERMISOS[role]?.includes(action) ?? false;
}

/** Las acciones que un rol puede ejecutar. La usa el panel para no dibujar botones que van a dar 403. */
export function actionsFor(role: PlatformRole): readonly PlatformAction[] {
  return PERMISOS[role] ?? [];
}

/**
 * Motivo de la acción: **obligatorio**, y esa es la mitad del valor de la fase 2.
 *
 * Una bitácora que dice «superadmin suspendió la cuenta X» no sirve para nada tres meses después.
 * La que dice «suspendida por falta de pago de la factura 1042» sí. Se exige un mínimo de longitud
 * porque un campo obligatorio que acepta «.» es un campo opcional con pasos de más.
 */
export const MOTIVO_MIN = 10;
export const MOTIVO_MAX = 500;

export function validateReason(raw: unknown): string {
  const motivo = String(raw ?? '').trim();
  if (motivo.length < MOTIVO_MIN)
    throw new Error(
      `El motivo es obligatorio y tiene que explicar la decisión (mínimo ${MOTIVO_MIN} caracteres). ` +
        'Queda en la bitácora: es lo que permite entender la acción meses después.',
    );
  if (motivo.length > MOTIVO_MAX) throw new Error(`El motivo no puede pasar de ${MOTIVO_MAX} caracteres.`);
  return motivo;
}
