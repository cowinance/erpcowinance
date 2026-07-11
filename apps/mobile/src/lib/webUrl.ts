import { Linking } from 'react-native';

/**
 * URL pública de la app web (P1.3.6).
 *
 * - Nombre: `EXPO_PUBLIC_WEB_URL`.
 * - Valor esperado: la base de la web (p. ej. `https://app.cowinance.com`).
 * - Sin configurar: queda `undefined` → la UI muestra instrucciones en texto,
 *   SIN hardcodear dominios ni localhost, y sin ofrecer un botón "Abrir web".
 *
 * Nunca se hardcodea una URL en los componentes; todo sale de esta variable.
 */
export const WEB_URL = process.env.EXPO_PUBLIC_WEB_URL?.trim() || undefined;

/** Abre la web SOLO si hay URL configurada y el sistema puede abrirla. */
export async function openWeb(path = ''): Promise<boolean> {
  if (!WEB_URL) return false;
  const url = `${WEB_URL.replace(/\/$/, '')}${path}`;
  try {
    if (await Linking.canOpenURL(url)) {
      await Linking.openURL(url);
      return true;
    }
  } catch {
    /* no-op: si no se puede abrir, la UI ya mostró instrucciones */
  }
  return false;
}
