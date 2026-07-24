import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'crypto';
import { S3FileStorage, s3ConfigFromEnv } from './s3-file-storage';

/**
 * Verificación del adaptador S3 contra un almacén REAL. Es la única prueba que vale para la firma
 * SigV4: el servidor la recalcula y rechaza la request si no coincide, así que un PUT/GET que
 * funciona ES la validación del algoritmo. Los tests unitarios del firmador solo cubren la forma.
 *
 * Se saltea si no hay un almacén configurado, para no atar la suite a Docker. Para correrla:
 *
 *   docker run -d --rm --name cw-minio -p 9010:9000 \
 *     -e MINIO_ROOT_USER=cowinance -e MINIO_ROOT_PASSWORD=cowinance-secret \
 *     minio/minio server /data
 *   docker exec cw-minio mkdir -p /data/cowinance-media
 *
 *   S3_TEST=1 S3_ENDPOINT=http://localhost:9010 S3_BUCKET=cowinance-media \
 *     S3_ACCESS_KEY_ID=cowinance S3_SECRET_ACCESS_KEY=cowinance-secret \
 *     npx vitest run apps/api/src/infra/storage
 */
describe.skipIf(!process.env.S3_TEST)('S3FileStorage contra un almacén real', () => {
  // En `beforeAll`, no en el cuerpo del `describe`: ese cuerpo se EJECUTA aunque la suite esté
  // salteada, y leer la config ahí hacía fallar la suite entera cuando no había almacén.
  let storage: S3FileStorage;
  beforeAll(() => {
    storage = new S3FileStorage(s3ConfigFromEnv());
  });

  const key = () => `tenant-de-prueba/${randomUUID()}`;

  it('guarda y recupera los mismos bytes', async () => {
    const k = key();
    const bytes = Buffer.from('cowinance · prueba de almacenamiento · ñ é 🐄', 'utf8');
    await storage.put(k, bytes, 'text/plain');
    expect(await storage.get(k)).toEqual(bytes);
  });

  it('preserva bytes binarios sin tocarlos', async () => {
    const k = key();
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0x1a, 0x0a]);
    await storage.put(k, bytes, 'image/png');
    expect(await storage.get(k)).toEqual(bytes);
  });

  // Distinguir "no existe" de "falló" es lo que permite a media devolver 404 y no 500.
  it('devuelve null —no lanza— cuando la clave no existe', async () => {
    expect(await storage.get(key())).toBeNull();
  });

  it('sobrescribe una clave existente', async () => {
    const k = key();
    await storage.put(k, Buffer.from('primera'), 'text/plain');
    await storage.put(k, Buffer.from('segunda'), 'text/plain');
    expect((await storage.get(k))?.toString()).toBe('segunda');
  });

  it('un secreto incorrecto falla con el detalle del servidor, no en silencio', async () => {
    const malo = new S3FileStorage({ ...s3ConfigFromEnv(), secretAccessKey: 'clave-que-no-es' });
    await expect(malo.put(key(), Buffer.from('x'), 'text/plain')).rejects.toThrow(/No se pudo guardar/);
  });
});
