import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useSync, API_URL } from '@/sync/SyncContext';

/**
 * Capa de sesión/cuenta (P1.3.6), SEPARADA del estado operativo de sync.
 *
 * Responsabilidad única: identidad del actor (nombre, email, rol) y estado de
 * verificación de email, leídos de /auth/me. NO vive en el store de sync, ni en
 * las tablas ganaderas, ni en el payload de bootstrap/pull.
 *
 * - Reutiliza `sync.authFetch` (Bearer + refresh + 401→login) — sin flujo de auth
 *   paralelo (condición 3).
 * - Metadatos en MEMORIA. El nombre/email de arranque en frío se toman de la meta
 *   ya persistida por el login (`sync.userName`/`sync.userEmail`) → nunca un nombre
 *   hardcodeado mientras resuelve /auth/me. `email_verified` NO se persiste: se
 *   re-lee cada sesión/foreground (no es dato a cachear).
 * - Offline: si /auth/me falla, se conserva el último nombre conocido y la
 *   verificación queda 'unknown'; no se hace logout ni se borra el store.
 */
type Verified = boolean | 'unknown';

interface AccountCtx {
  name?: string;
  email?: string;
  role?: string;
  emailVerified: Verified;
  refreshing: boolean;
  /** Re-lee /auth/me (acción manual "Ya verifiqué / actualizar"). */
  refresh: () => Promise<void>;
  /** Reenvía verificación (POST /resend-verification, anti-enumeración). */
  resendVerification: () => Promise<'sent' | 'error'>;
}

const Ctx = createContext<AccountCtx | null>(null);
export const useAccount = () => {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAccount fuera de AccountProvider');
  return ctx;
};

export function AccountProvider({ children }: { children: React.ReactNode }) {
  const sync = useSync();
  const [fetched, setFetched] = useState<{ name?: string; email?: string; role?: string } | null>(null);
  const [emailVerified, setEmailVerified] = useState<Verified>('unknown');
  const [refreshing, setRefreshing] = useState(false);
  const inFlight = useRef(false);

  /**
   * Con la sesión cerrada no se muestra NADA del usuario anterior (condición 12).
   *
   * Antes esto se hacía borrando el estado desde un efecto al pasar al estado «login».
   * Sincronizar dos estados así deja una ventana —el render en que ya se cerró sesión pero el
   * efecto todavía no corrió— en la que el nombre viejo sigue en pantalla. Derivarlo cierra esa
   * ventana: no hay instante en que la sesión esté cerrada y los datos se sigan viendo.
   */
  const cerrado = sync.status === 'login';
  const visible = cerrado ? null : fetched;

  // Nombre/email efectivos: lo de /auth/me si llegó; si no, la meta persistida
  // (arranque en frío) → sin nombre hardcodeado. Cae a undefined → saludo neutral.
  const name = visible?.name ?? sync.userName;
  const email = visible?.email ?? sync.userEmail;
  const role = visible?.role;
  const emailVerificadoVisible: Verified = cerrado ? 'unknown' : emailVerified;

  const refresh = useCallback(async () => {
    if (inFlight.current || sync.status !== 'ready') return;
    inFlight.current = true;
    setRefreshing(true);
    try {
      const res = await sync.authFetch('/auth/me');
      if (res.ok) {
        const me = await res.json();
        setFetched({ name: me?.name, email: me?.email, role: me?.role });
        setEmailVerified(!!me?.email_verified);
      }
      // !ok: 401 → authFetch ya mandó a login; otro código → conservamos lo último.
    } catch {
      // Red caída: conservamos el último nombre; verificación queda 'unknown'.
    } finally {
      inFlight.current = false;
      setRefreshing(false);
    }
  }, [sync]);

  // Carga tras login exitoso o restauración de sesión válida (status → ready).
  useEffect(() => {
    // Carga asíncrona: el `setState` ocurre DESPUÉS del primer `await`, no mientras corre el
    // efecto. La regla no puede ver a través del await y lo reporta igual.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (sync.status === 'ready') refresh();
  }, [sync.status, refresh]);

  // Refresco al volver a foreground (dedupe vía inFlight en refresh()).
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

  const resendVerification = useCallback(async (): Promise<'sent' | 'error'> => {
    if (!email) return 'error';
    try {
      // Endpoint público; anti-enum: cualquier respuesta del servidor = 'sent'.
      await fetch(`${API_URL}/resend-verification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      return 'sent';
    } catch {
      return 'error'; // solo fallo de red
    }
  }, [email]);

  const value = useMemo<AccountCtx>(
    () => ({ name, email, role, emailVerified: emailVerificadoVisible, refreshing, refresh, resendVerification }),
    [name, email, role, emailVerificadoVisible, refreshing, refresh, resendVerification],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
