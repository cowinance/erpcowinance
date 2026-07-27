import { NextRequest, NextResponse } from 'next/server';
import { DIRECT_API_URL } from '@/lib/api';
import { PLATFORM_COOKIE } from '@/lib/admin-session';
import { clearSessionCookies } from '@/lib/session';

/**
 * Salir del modo espejo.
 *
 * Dos cosas, y la segunda es la que importa para la auditoría:
 *
 *  1. Se borran las cookies del ERP — la persona deja de estar dentro de la finca del cliente.
 *  2. Se registra el CIERRE en la bitácora, con el `sid` que ata inicio y fin.
 *
 * El token no se revoca porque es un JWT sin estado; lo que lo termina es el vencimiento a los 10
 * minutos. Borrar la cookie es lo que corta el acceso EN ESTE NAVEGADOR, que es de lo que se trata:
 * el token ya no está en ningún lado desde donde usarse.
 *
 * Que el registro del cierre falle no puede impedir la salida: quedarse adentro de la finca de un
 * cliente porque no se pudo escribir un log sería exactamente al revés de lo que conviene.
 */
export async function POST(req: NextRequest) {
  const { sid } = (await req.json().catch(() => ({}))) as { sid?: string };
  const plataforma = req.cookies.get(PLATFORM_COOKIE)?.value;

  if (sid && plataforma) {
    try {
      await fetch(`${DIRECT_API_URL}/platform/impersonation/end`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${plataforma}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sid }),
        cache: 'no-store',
      });
    } catch {
      /* la salida no depende del registro */
    }
  }

  const res = NextResponse.json({ ok: true });
  clearSessionCookies(res);
  return res;
}
