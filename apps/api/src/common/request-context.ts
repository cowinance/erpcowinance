import { AsyncLocalStorage } from 'async_hooks';
import type { Q } from '../db/query';

/**
 * Contexto de la request autenticada, propagado por AsyncLocalStorage:
 * quién es el actor, a qué tenant pertenece y el handle transaccional
 * de la request (con `app.tenant_id` fijado para RLS).
 */
export interface AuthContext {
  userId: string;
  tenantId: string;
  role: string;
  email?: string;
  name?: string;
  /**
   * Presente SOLO en modo espejo (soporte entrando como un usuario de finca). Que exista significa
   * dos cosas: la transacción está en solo lectura, y la persona detrás de la request NO es
   * `userId` sino quien figura acá. Cualquier código que registre «quién hizo esto» debería
   * mirarlo antes de atribuirle la acción al cliente.
   *
   * Se tipa suelto a propósito: `common/` no debe depender de un módulo (`modules/platform`), o el
   * grafo de dependencias se invierte y aparece un ciclo.
   */
  impersonatedBy?: { by: string; by_email: string; by_role: string; sid: string };
  q?: Q;
}

export const requestContext = new AsyncLocalStorage<AuthContext>();

/**
 * ¿Esta request es una sesión de SOLO LECTURA (modo espejo)?
 *
 * La usan los pocos `GET` que escriben como efecto —los read-through: evaluar alertas, generar el
 * ledger de notificaciones, crear el trial— para COMPUTAR igual pero saltear la persistencia.
 *
 * **No es un control de seguridad y no hay que tratarlo como tal.** Lo que impide escribir es la
 * transacción READ ONLY que fija el interceptor; si alguien se olvida de consultar esto, el motor
 * rechaza la escritura igual. Esto existe solo para que el soporte vea una pantalla útil en vez de
 * un 403 en la mitad del panel: la diferencia entre «no puedo escribir» y «no puedo mostrarte
 * nada».
 */
export function isReadOnlySession(): boolean {
  return !!requestContext.getStore()?.impersonatedBy;
}
