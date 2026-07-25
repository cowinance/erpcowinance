import { existsSync, readFileSync } from 'fs';

/**
 * TLS de la conexión a PostgreSQL — regla única, sin I/O de red.
 *
 * POR QUÉ EXISTE. Contra una base gestionada (RDS, Cloud SQL, Neon) el certificado lo firma la CA
 * del proveedor, que NO está en el almacén de confianza de Node. Y en la versión de `pg` que usamos,
 * poner `?sslmode=require` en la cadena se interpreta como `verify-full`: verificación estricta que
 * falla justamente porque falta esa CA. El camino que queda —`sslmode=no-verify`— cifra pero **no
 * verifica con quién habla**, así que no protege de un intermediario: la contraseña de la base y
 * todos los datos de las fincas viajan hacia quien haya podido ponerse en el medio.
 *
 * Con `DATABASE_SSL_CA` se pasa la CA del proveedor y la verificación vuelve a ser real.
 *
 * Se acepta la ruta a un archivo O el PEM completo pegado en la variable: montar un archivo en un
 * contenedor no siempre está a mano, y obligar a hacerlo empuja a la gente al `no-verify`.
 */

export interface DbSslConfig {
  ca: string;
  rejectUnauthorized: true;
}

export class InvalidDbSslError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidDbSslError';
  }
}

const PEM_HEADER = 'BEGIN CERTIFICATE';

/**
 * Devuelve la configuración TLS, o `undefined` si no se pidió ninguna — y entonces manda lo que diga
 * la cadena de conexión, que es el comportamiento de siempre para el Postgres del compose, donde el
 * tráfico no sale de una red privada.
 */
export function dbSslFromEnv(env: NodeJS.ProcessEnv = process.env): DbSslConfig | undefined {
  const bruto = env.DATABASE_SSL_CA;
  if (!bruto || !bruto.trim()) return undefined;

  // El PEM va SIN recortar: el salto de línea final es parte del formato y hay parsers que lo piden.
  // El recorte se aplica solo cuando el valor es una ruta.
  if (bruto.includes(PEM_HEADER)) return { ca: bruto, rejectUnauthorized: true };

  const valor = bruto.trim();
  if (!existsSync(valor))
    throw new InvalidDbSslError(
      `DATABASE_SSL_CA apunta a un archivo que no existe: ${valor}. Puede ser una ruta al bundle de la CA ` +
        'o el PEM completo pegado en la variable.',
    );

  const pem = readFileSync(valor, 'utf8');
  if (!pem.includes(PEM_HEADER))
    throw new InvalidDbSslError(`El archivo de DATABASE_SSL_CA no parece un certificado PEM: ${valor}`);
  return { ca: pem, rejectUnauthorized: true };
}

/**
 * ¿Esta conexión sale de la máquina sin cifrar?
 *
 * Se avisa, no se aborta: contra el Postgres del compose —misma red privada, host `db`— exigir TLS
 * sería pedir certificados para un tráfico que nunca toca la red pública. Pero apuntar a un host
 * remoto sin TLS sí merece un grito, porque manda la contraseña de la base en claro.
 */
export function warnsAboutPlaintext(url: string, ssl: DbSslConfig | undefined): boolean {
  if (ssl) return false;
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return false; // una URL que no parsea ya va a fallar sola al conectar
  }
  if (/sslmode=/.test(url)) return false; // se eligió explícitamente: no se opina
  const local = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  // Los nombres de servicio de compose (`db`, `postgres`) no tienen punto: son de red interna.
  const interno = !host.includes('.');
  return !local && !interno;
}
