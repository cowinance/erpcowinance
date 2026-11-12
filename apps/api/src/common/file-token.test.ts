import { describe, expect, it } from 'vitest';
import * as jwt from 'jsonwebtoken';
import { JWT_ISSUER, JWT_SECRET } from '../modules/auth/auth.service';
import { signFileToken, verifyFileToken } from './file-token';

/**
 * El token que autoriza a servir un archivo.
 *
 * `GET /v1/files/:id/content` es **pública**: no hay sesión ni contexto de tenant, el token ES la
 * autorización, y de él sale el tenant con el que se arma la ruta en el almacenamiento. Un error
 * acá no da un 500 que alguien note: da acceso a un archivo que no corresponde, en silencio.
 *
 * Por eso lo que se prueba es sobre todo lo que tiene que ser RECHAZADO.
 */
describe('token de archivo firmado', () => {
  const FILE = '11111111-1111-4111-8111-111111111111';
  const TENANT = '22222222-2222-4222-8222-222222222222';

  it('va y vuelve con el archivo, el tenant y el mime', () => {
    const claims = verifyFileToken(signFileToken(FILE, TENANT, 'image/jpeg'));
    expect(claims).toEqual({ fid: FILE, ten: TENANT, mime: 'image/jpeg' });
  });

  it('un token basura no revienta: devuelve null', () => {
    expect(verifyFileToken('')).toBeNull();
    expect(verifyFileToken('no-es-un-token')).toBeNull();
    expect(verifyFileToken('a.b.c')).toBeNull();
  });

  /** Sin esto, cualquier token de sesión robado serviría para bajar archivos. */
  it('un token que no es de archivo se rechaza, aunque esté bien firmado', () => {
    const acceso = jwt.sign({ sub: 'u1', ten: TENANT, typ: 'access' }, JWT_SECRET, { issuer: JWT_ISSUER });
    expect(verifyFileToken(acceso)).toBeNull();
    const sinTipo = jwt.sign({ fid: FILE, ten: TENANT, mime: 'image/jpeg' }, JWT_SECRET, { issuer: JWT_ISSUER });
    expect(verifyFileToken(sinTipo)).toBeNull();
  });

  it('un token firmado con otra clave se rechaza', () => {
    const ajeno = jwt.sign({ fid: FILE, ten: TENANT, mime: 'image/jpeg', typ: 'file' }, 'otra-clave-cualquiera', {
      issuer: JWT_ISSUER,
    });
    expect(verifyFileToken(ajeno)).toBeNull();
  });

  it('un token de otro emisor se rechaza', () => {
    const otroIss = jwt.sign({ fid: FILE, ten: TENANT, mime: 'image/jpeg', typ: 'file' }, JWT_SECRET, {
      issuer: 'otro-sistema',
    });
    expect(verifyFileToken(otroIss)).toBeNull();
  });

  /** El vencimiento corto es la mitad de la protección: un enlace filtrado deja de servir. */
  it('un token vencido se rechaza', () => {
    const vencido = jwt.sign({ fid: FILE, ten: TENANT, mime: 'image/jpeg', typ: 'file' }, JWT_SECRET, {
      issuer: JWT_ISSUER,
      expiresIn: -60,
    });
    expect(verifyFileToken(vencido)).toBeNull();
  });

  it('el token recién emitido no está vencido y dura unas horas', () => {
    const { exp, iat } = jwt.decode(signFileToken(FILE, TENANT, 'image/png')) as { exp: number; iat: number };
    const horas = (exp - iat) / 3600;
    expect(horas).toBeGreaterThan(1);
    expect(horas).toBeLessThanOrEqual(24);
  });

  /** Cambiar el tenant en el payload cambiaría la carpeta de la que se lee. */
  it('manosear el payload invalida la firma', () => {
    const token = signFileToken(FILE, TENANT, 'image/jpeg');
    const [cabecera, cuerpo, firma] = token.split('.');
    const alterado = JSON.parse(Buffer.from(cuerpo, 'base64url').toString());
    alterado.ten = '33333333-3333-4333-8333-333333333333';
    const falso = `${cabecera}.${Buffer.from(JSON.stringify(alterado)).toString('base64url')}.${firma}`;
    expect(verifyFileToken(falso)).toBeNull();
  });
});
