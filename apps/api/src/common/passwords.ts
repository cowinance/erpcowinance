import { randomBytes, scrypt, timingSafeEqual } from 'crypto';
import { promisify } from 'util';

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: string,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/**
 * Parámetros de derivación por esquema. El esquema viaja EN el hash (prefijo), así que
 * subir el costo no invalida las contraseñas ya guardadas: se verifican con los parámetros
 * con los que se crearon y se re-hashean al próximo login (ver `needsRehash`).
 *
 * - `s2` (histórico): defaults de Node (N=2^14 = 16 MiB). Por debajo del mínimo que
 *   recomienda OWASP para scrypt; se sigue VERIFICANDO pero ya no se emite.
 * - `s3` (actual): N=2^16, r=8, p=1 → 64 MiB por derivación, ~90 ms. El costo en memoria
 *   es lo que encarece el ataque con GPU/ASIC, que es el punto de scrypt.
 *
 * `maxmem` hay que pasarlo explícito: el default de Node es 32 MiB y `s3` necesita 64.
 */
const PARAMS = {
  s2: { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
  s3: { N: 65536, r: 8, p: 1, maxmem: 192 * 1024 * 1024 },
} as const;

type Scheme = keyof typeof PARAMS;

/** Esquema con el que se emiten los hashes nuevos. */
const CURRENT: Scheme = 's3';

const KEYLEN = 64;

/**
 * Hash de contraseña con scrypt (formato `<esquema>:salt:hash`, sin dependencias).
 *
 * Asíncrono a propósito: `scryptSync` con estos parámetros bloquea el event loop ~90 ms
 * por llamada, y el login es justamente un endpoint público — un puñado de requests
 * concurrentes congelaría el proceso entero. La versión async deriva en el threadpool.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const hash = (await scryptAsync(password, salt, KEYLEN, PARAMS[CURRENT])).toString('hex');
  return `${CURRENT}:${salt}:${hash}`;
}

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  const parsed = parse(stored);
  if (!parsed) return false;
  const candidate = await scryptAsync(password, parsed.salt, KEYLEN, PARAMS[parsed.scheme]);
  const expected = Buffer.from(parsed.hash, 'hex');
  // `timingSafeEqual` LANZA si los buffers difieren en longitud: un hash truncado en la base
  // daría 500 en vez de "credenciales inválidas". Se compara la longitud primero.
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

/**
 * ¿El hash guardado quedó con parámetros viejos? El login lo usa para re-hashear en caliente:
 * es el único momento en que la contraseña en claro está disponible. Sin esto, un tenant
 * creado hace meses se queda para siempre con el costo débil.
 */
export function needsRehash(stored: string | null | undefined): boolean {
  const parsed = parse(stored);
  return parsed ? parsed.scheme !== CURRENT : false;
}

function parse(stored: string | null | undefined): { scheme: Scheme; salt: string; hash: string } | null {
  if (!stored) return null;
  const [scheme, salt, hash] = stored.split(':');
  if (!salt || !hash || !(scheme in PARAMS)) return null;
  return { scheme: scheme as Scheme, salt, hash };
}
