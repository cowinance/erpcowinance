import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { InvalidDbSslError, dbSslFromEnv, warnsAboutPlaintext } from './db-ssl';

const PEM = '-----BEGIN CERTIFICATE-----\nMIIBfake\n-----END CERTIFICATE-----\n';
const tmp = mkdtempSync(join(tmpdir(), 'dbssl-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('dbSslFromEnv', () => {
  // Sin pedir nada, manda la cadena de conexión: es el Postgres del compose, en red privada.
  it('sin la variable no configura TLS', () => {
    expect(dbSslFromEnv({})).toBeUndefined();
    expect(dbSslFromEnv({ DATABASE_SSL_CA: '   ' })).toBeUndefined();
  });

  /**
   * Se acepta el PEM pegado en la variable porque montar un archivo en un contenedor no siempre está
   * a mano, y obligar a hacerlo empuja a la gente al `sslmode=no-verify`, que cifra sin verificar.
   */
  it('acepta el PEM pegado en la variable', () => {
    expect(dbSslFromEnv({ DATABASE_SSL_CA: PEM })).toEqual({ ca: PEM, rejectUnauthorized: true });
  });

  it('acepta la ruta a un archivo', () => {
    const ruta = join(tmp, 'rds-ca.pem');
    writeFileSync(ruta, PEM);
    expect(dbSslFromEnv({ DATABASE_SSL_CA: ruta })).toEqual({ ca: PEM, rejectUnauthorized: true });
  });

  // Fallar al arrancar y no al primer usuario: si la ruta está mal, la conexión caería igual pero
  // con un error de TLS que no dice nada del archivo.
  it('falla claro si la ruta no existe o el contenido no es un certificado', () => {
    expect(() => dbSslFromEnv({ DATABASE_SSL_CA: join(tmp, 'no-esta.pem') })).toThrow(InvalidDbSslError);
    const basura = join(tmp, 'basura.pem');
    writeFileSync(basura, 'esto no es un certificado');
    expect(() => dbSslFromEnv({ DATABASE_SSL_CA: basura })).toThrow(/no parece un certificado PEM/);
  });

  it('la verificación NUNCA queda desactivada', () => {
    // No hay camino en esta función que devuelva `rejectUnauthorized: false`: para eso está
    // `sslmode=no-verify` en la cadena, que es una decisión explícita de quien despliega.
    expect(dbSslFromEnv({ DATABASE_SSL_CA: PEM })!.rejectUnauthorized).toBe(true);
  });
});

describe('warnsAboutPlaintext', () => {
  const ssl = { ca: PEM, rejectUnauthorized: true as const };

  it('avisa cuando el host es remoto y no se pidió TLS', () => {
    expect(warnsAboutPlaintext('postgres://u:p@mi-base.rds.amazonaws.com:5432/cowinance', undefined)).toBe(true);
  });

  it('no avisa si ya hay TLS configurado', () => {
    expect(warnsAboutPlaintext('postgres://u:p@mi-base.rds.amazonaws.com:5432/cowinance', ssl)).toBe(false);
  });

  /**
   * Contra el Postgres del compose el tráfico no sale de una red privada: exigir certificados ahí
   * sería pedir ceremonia por un riesgo que no existe, y un aviso que se repite sin motivo entrena a
   * ignorar los avisos.
   */
  it('no avisa por localhost ni por un nombre de servicio de compose', () => {
    for (const host of ['localhost', '127.0.0.1', 'db', 'postgres'])
      expect(warnsAboutPlaintext(`postgres://u:p@${host}:5432/cowinance`, undefined)).toBe(false);
  });

  // Quien puso `sslmode` ya decidió, incluso si eligió `no-verify`: no se opina encima.
  it('no avisa si la cadena declara un sslmode', () => {
    expect(warnsAboutPlaintext('postgres://u:p@x.rds.amazonaws.com:5432/c?sslmode=no-verify', undefined)).toBe(false);
  });

  it('una URL que no parsea no genera ruido: va a fallar sola al conectar', () => {
    expect(warnsAboutPlaintext('no-es-una-url', undefined)).toBe(false);
  });
});
