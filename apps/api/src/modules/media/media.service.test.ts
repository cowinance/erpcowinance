import { describe, expect, it } from 'vitest';
import * as jwt from 'jsonwebtoken';
import type { DbService } from '../../db/db.service';
import { JWT_ISSUER, JWT_SECRET } from '../auth/auth.service';
import { signFileToken } from '../../common/file-token';
import { fileKey, type FileStorage } from '../../application/ports/file-storage.port';
import { MediaService } from './media.service';

/**
 * Servir un archivo es la única ruta PÚBLICA del módulo: sin sesión, sin contexto de tenant. La
 * ruta en el almacenamiento se arma con el tenant que viene DENTRO del token, así que el token es
 * toda la autorización que hay.
 *
 * `serve()` no toca la base —solo el token y el almacenamiento— y por eso se puede probar sin
 * levantar PGlite. Lo demás del módulo (subir, listar) sí necesita base y queda para integración.
 */
describe('MediaService.serve', () => {
  const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const TENANT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const FILE_A = '11111111-1111-4111-8111-111111111111';
  const FILE_B = '22222222-2222-4222-8222-222222222222';

  /** Almacén de mentira con un archivo de cada finca, en la ruta real (`tenant/archivo`). */
  function almacen() {
    const archivos = new Map<string, Buffer>([
      [fileKey(TENANT_A, FILE_A), Buffer.from('foto de la finca A')],
      [fileKey(TENANT_B, FILE_B), Buffer.from('foto de la finca B')],
    ]);
    const storage: FileStorage = {
      put: async () => undefined,
      get: async (key: string) => archivos.get(key) ?? null,
      delete: async () => undefined,
    } as unknown as FileStorage;
    return new MediaService(null as unknown as DbService, storage);
  }

  const rechaza = (codigo: string, fn: () => Promise<unknown>) =>
    expect(fn()).rejects.toMatchObject({ response: { code: codigo } });

  it('con su token devuelve el archivo y el mime que el token declara', async () => {
    const r = await almacen().serve(FILE_A, signFileToken(FILE_A, TENANT_A, 'image/jpeg'));
    expect(r.buffer.toString()).toBe('foto de la finca A');
    expect(r.mime).toBe('image/jpeg');
  });

  /**
   * El invariante que protege de leer archivos ajenos: el id de la URL tiene que coincidir con el
   * del token. Sin esa comparación, un token legítimo de un archivo propio serviría para pedir
   * CUALQUIER otro id — y la ruta se armaría igual, porque el tenant sale del token.
   */
  it('un token de un archivo no sirve para pedir otro', async () => {
    const tokenDeA = signFileToken(FILE_A, TENANT_A, 'image/jpeg');
    await rechaza('media.invalid_token', () => almacen().serve(FILE_B, tokenDeA));
  });

  it('un token de otra finca no alcanza el archivo de esta', async () => {
    // Token bien firmado, pero emitido para el tenant B: la ruta que arma es la de B.
    const tokenDeB = signFileToken(FILE_A, TENANT_B, 'image/jpeg');
    await rechaza('media.file_missing', () => almacen().serve(FILE_A, tokenDeB));
  });

  it('sin token, con token roto o vencido, no sirve nada', async () => {
    await rechaza('media.invalid_token', () => almacen().serve(FILE_A, ''));
    await rechaza('media.invalid_token', () => almacen().serve(FILE_A, 'no-es-un-token'));
    const vencido = jwt.sign({ fid: FILE_A, ten: TENANT_A, mime: 'image/jpeg', typ: 'file' }, JWT_SECRET, {
      issuer: JWT_ISSUER,
      expiresIn: -60,
    });
    await rechaza('media.invalid_token', () => almacen().serve(FILE_A, vencido));
  });

  it('un token de sesión no sirve para bajar archivos', async () => {
    const acceso = jwt.sign({ sub: 'u1', ten: TENANT_A, typ: 'access' }, JWT_SECRET, { issuer: JWT_ISSUER });
    await rechaza('media.invalid_token', () => almacen().serve(FILE_A, acceso));
  });

  /** Un archivo que la base conoce y el almacenamiento perdió es un 404, no un 500. */
  it('un archivo que no está en el almacenamiento da «no encontrado»', async () => {
    const fantasma = '99999999-9999-4999-8999-999999999999';
    await rechaza('media.file_missing', () => almacen().serve(fantasma, signFileToken(fantasma, TENANT_A, 'image/png')));
  });
});
