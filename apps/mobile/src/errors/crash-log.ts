/**
 * Registro local de fallos de render.
 *
 * Hoy un error de render deja pantalla blanca y nadie se entera nunca: la app está en un potrero,
 * sin consola y muchas veces sin señal. Un servicio remoto solo reporta cuando hay conexión, que
 * es justo lo que falta cuando el problema ocurre, así que lo primero es dejar rastro EN EL
 * TELÉFONO. Enviarlo a un servicio es un paso posterior y aditivo: `reportarFallo` es la costura.
 *
 * Módulo puro —sin React, sin Expo, sin almacenamiento—: decide qué se guarda, no dónde.
 */

export interface CrashRecord {
  /** Instante del fallo, ISO. */
  at: string;
  message: string;
  /** Pila recortada; ver `MAX_STACK_CHARS`. */
  stack?: string;
  /** Árbol de componentes que React entrega en `componentDidCatch`. */
  component?: string;
}

/**
 * Cuántos fallos se conservan. Diez alcanza para ver si algo se repite y es poco para el
 * almacenamiento de un teléfono. Se guarda el más reciente primero.
 */
export const MAX_CRASHES = 10;

/**
 * Una pila de React Native puede traer miles de caracteres de rutas de bundle. Lo que sirve para
 * diagnosticar está arriba; el resto solo ocupa lugar en un dispositivo que puede estar lleno.
 */
export const MAX_STACK_CHARS = 2_000;

/**
 * Tapa lo que parezca una credencial antes de guardarlo. Un mensaje de error no debería traer un
 * token, pero esto persiste texto arbitrario en el dispositivo y después se comparte para
 * diagnosticar: el momento de no escribirlo es antes de guardarlo, no después.
 */
export function redactar(texto: string): string {
  return texto
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/g, '«token»')
    .replace(/\b(Bearer|access_token|refresh_token|password)\b\s*[:=]?\s*\S+/gi, '$1 «oculto»');
}

function recortar(texto: string | undefined, max: number): string | undefined {
  if (!texto) return undefined;
  const limpio = redactar(texto);
  return limpio.length <= max ? limpio : `${limpio.slice(0, max)}\n… (recortado)`;
}

/** Normaliza lo que haya tirado React —que puede no ser un Error— a un registro guardable. */
export function toCrashRecord(error: unknown, componentStack: string | undefined, now: Date): CrashRecord {
  const message =
    error instanceof Error ? error.message : typeof error === 'string' ? error : 'Error desconocido en el render';
  return {
    at: now.toISOString(),
    message: redactar(message) || 'Error desconocido en el render',
    stack: recortar(error instanceof Error ? error.stack : undefined, MAX_STACK_CHARS),
    component: recortar(componentStack, MAX_STACK_CHARS),
  };
}

/** Agrega el fallo al principio y poda los más viejos. Nunca muta la lista recibida. */
export function appendCrash(prev: CrashRecord[] | undefined, record: CrashRecord, max = MAX_CRASHES): CrashRecord[] {
  return [record, ...(prev ?? [])].slice(0, Math.max(1, max));
}

/** Texto plano para compartir por WhatsApp o correo, que es como va a llegar desde el campo. */
export function formatCrashes(records: CrashRecord[]): string {
  if (records.length === 0) return 'Sin fallos registrados.';
  return records
    .map((c, i) => [`#${i + 1} · ${c.at}`, c.message, c.stack, c.component].filter(Boolean).join('\n'))
    .join('\n\n───\n\n');
}
