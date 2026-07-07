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
  q?: Q;
}

export const requestContext = new AsyncLocalStorage<AuthContext>();
