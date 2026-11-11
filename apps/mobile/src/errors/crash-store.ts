/**
 * Dónde se guardan los fallos. A propósito NO usa `DeviceStorage` ni el store de sync: lo que hay
 * que registrar es, entre otras cosas, que ese motor falló. Un registrador que depende de la pieza
 * que puede estar rota no registra nada el día que importa.
 *
 * AsyncStorage sirve en nativo y en web, es una sola clave y cada operación es best-effort: si
 * falla, se pierde el registro del fallo, no la app.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { appendCrash, toCrashRecord, type CrashRecord } from './crash-log';

const CLAVE = 'cowinance.crashes.v1';

export async function leerFallos(): Promise<CrashRecord[]> {
  try {
    const crudo = await AsyncStorage.getItem(CLAVE);
    if (!crudo) return [];
    const parsed: unknown = JSON.parse(crudo);
    return Array.isArray(parsed) ? (parsed as CrashRecord[]) : [];
  } catch {
    return [];
  }
}

/**
 * Deja constancia de un fallo. Se llama desde `componentDidCatch`, o sea desde un punto donde algo
 * ya salió mal: no puede lanzar bajo ninguna circunstancia.
 */
export async function registrarFallo(error: unknown, componentStack: string | undefined, now = new Date()): Promise<void> {
  try {
    const previos = await leerFallos();
    const lista = appendCrash(previos, toCrashRecord(error, componentStack, now));
    await AsyncStorage.setItem(CLAVE, JSON.stringify(lista));
  } catch {
    /* si ni esto se puede guardar, no hay nada mejor que hacer desde acá */
  }
}

export async function borrarFallos(): Promise<void> {
  try {
    await AsyncStorage.removeItem(CLAVE);
  } catch {
    /* best-effort */
  }
}
