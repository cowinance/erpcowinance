'use server';

import { revalidatePath } from 'next/cache';
import { adminPost } from '@/lib/admin-api';

/**
 * Acciones del panel — FASE 2, como Server Actions.
 *
 * POR QUÉ SERVER ACTIONS Y NO UN PROXY. El token de plataforma vive en una cookie `HttpOnly` que el
 * JavaScript de la página no puede leer, igual que la sesión del ERP. Para el ERP hizo falta un
 * proxy (`/api/cw`) porque son ~200 llamadas desde el navegador; acá son cinco acciones puntuales
 * desde pantallas que ya se renderizan en el servidor, así que la acción corre del lado del
 * servidor y el token nunca sale de ahí — ni siquiera hacia un proxy del mismo origen.
 *
 * El `revalidatePath` es lo que hace que la fila se vea actualizada al volver: sin él la página
 * queda con el estado viejo y parece que la acción no funcionó.
 */

export type ResultadoAccion = { ok: true; mensaje: string } | { ok: false; error: string };

async function ejecutar(path: string, body: unknown, rutas: string[], exito: (d: any) => string): Promise<ResultadoAccion> {
  const r = await adminPost(path, body);
  if (!r.ok) return { ok: false, error: r.error };
  for (const ruta of rutas) revalidatePath(ruta);
  return { ok: true, mensaje: exito(r.data) };
}

export async function suspenderOrganizacion(id: string, motivo: string): Promise<ResultadoAccion> {
  return ejecutar(
    `/organizations/${id}/suspend`,
    { reason: motivo },
    [`/admin/organizaciones/${id}`, '/admin/organizaciones', '/admin'],
    (d) =>
      `Cuenta suspendida. ${d.revoked_sessions} sesión(es) cerrada(s). ` +
      'Un token ya emitido puede seguir valiendo hasta 15 minutos.',
  );
}

export async function reactivarOrganizacion(id: string, motivo: string): Promise<ResultadoAccion> {
  return ejecutar(
    `/organizations/${id}/reactivate`,
    { reason: motivo },
    [`/admin/organizaciones/${id}`, '/admin/organizaciones', '/admin'],
    () => 'Cuenta reactivada: ya puede volver a ingresar.',
  );
}

export async function cambiarPlan(id: string, planCode: string, motivo: string): Promise<ResultadoAccion> {
  return ejecutar(
    `/organizations/${id}/plan`,
    { plan_code: planCode, reason: motivo },
    [`/admin/organizaciones/${id}`, '/admin/organizaciones', '/admin'],
    (d) => `Plan cambiado de ${d.previous_plan} a ${d.plan.code}. No se generó ningún cobro.`,
  );
}

export async function bloquearUsuario(id: string, motivo: string): Promise<ResultadoAccion> {
  return ejecutar(
    `/users/${id}/block`,
    { reason: motivo },
    ['/admin/usuarios', '/admin'],
    (d) => `Usuario bloqueado. ${d.revoked_sessions} sesión(es) cerrada(s).`,
  );
}

export async function desbloquearUsuario(id: string, motivo: string): Promise<ResultadoAccion> {
  return ejecutar(`/users/${id}/unblock`, { reason: motivo }, ['/admin/usuarios', '/admin'], () =>
    'Usuario desbloqueado: ya puede volver a ingresar.',
  );
}
