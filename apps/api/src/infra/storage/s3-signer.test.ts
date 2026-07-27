import { describe, it, expect } from 'vitest';
import { signS3Request, type S3SignParams } from './s3-signer';

const BASE: S3SignParams = {
  method: 'PUT',
  endpoint: 'https://s3.us-east-1.amazonaws.com',
  bucket: 'cowinance',
  key: 'tenant-1/file-1',
  region: 'us-east-1',
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  payload: Buffer.from('hola'),
  contentType: 'image/jpeg',
  forcePathStyle: true,
  now: new Date('2026-07-24T22:00:00.000Z'),
};

const firma = (r: { headers: Record<string, string> }) => r.headers.Authorization.match(/Signature=([0-9a-f]+)/)![1];

describe('signS3Request', () => {
  it('arma la URL path-style: endpoint/bucket/clave', () => {
    expect(signS3Request(BASE).url).toBe('https://s3.us-east-1.amazonaws.com/cowinance/tenant-1/file-1');
  });

  /**
   * Este test AFIRMABA EL BUG: daba por buena una URL sin el bucket
   * (`https://s3.us-east-1.amazonaws.com/tenant-1/file-1`) mientras firmaba el host
   * `cowinance.s3.…`. O sea, aseguraba que la URL y el host firmado NO coincidieran — que es
   * exactamente la condición que hace que AWS rechace la firma.
   *
   * Es lo que pasa cuando un test se escribe para calzar con el código en vez de con el contrato:
   * queda en verde y encima protege el error. Se corrige al valor correcto.
   */
  it('arma la URL virtual-hosted cuando se apaga path-style (el estilo actual de AWS)', () => {
    const r = signS3Request({ ...BASE, forcePathStyle: false });
    expect(r.url).toBe('https://cowinance.s3.us-east-1.amazonaws.com/tenant-1/file-1');
    expect(r.headers.host).toBe('cowinance.s3.us-east-1.amazonaws.com');
  });

  it('firma con el scope y el algoritmo correctos', () => {
    const auth = signS3Request(BASE).headers.Authorization;
    expect(auth).toContain('AWS4-HMAC-SHA256');
    expect(auth).toContain('Credential=AKIAIOSFODNN7EXAMPLE/20260724/us-east-1/s3/aws4_request');
    expect(auth).toMatch(/SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date/);
  });

  it('manda el hash del cuerpo, no el cuerpo', () => {
    // sha256("hola")
    expect(signS3Request(BASE).headers['x-amz-content-sha256']).toBe(
      'b221d9dbb083a7f33428d7c2a3c3198ae925614d70210e28716ccaa7cd4ddb79',
    );
  });

  it('la fecha va en formato AMZ (sin guiones ni dos puntos)', () => {
    expect(signS3Request(BASE).headers['x-amz-date']).toBe('20260724T220000Z');
  });

  // La firma es determinista: misma entrada, misma salida. Es lo que hace que un cambio en
  // cualquier parte firmada sea detectable.
  it('es determinista', () => {
    expect(firma(signS3Request(BASE))).toBe(firma(signS3Request({ ...BASE })));
  });

  it.each([
    ['el cuerpo', { payload: Buffer.from('otra cosa') }],
    ['la clave', { key: 'tenant-1/file-2' }],
    ['el método', { method: 'GET' as const }],
    ['la fecha', { now: new Date('2026-07-25T22:00:00.000Z') }],
    ['la región', { region: 'eu-west-1' }],
    ['el secreto', { secretAccessKey: 'otro-secreto-cualquiera' }],
    ['el content-type', { contentType: 'application/pdf' }],
  ])('cambiar %s cambia la firma', (_desc, override) => {
    expect(firma(signS3Request({ ...BASE, ...override }))).not.toBe(firma(signS3Request(BASE)));
  });

  it('codifica por segmento: las barras de la clave separan, no se escapan', () => {
    const r = signS3Request({ ...BASE, key: 'tenant a/archivo con espacio.jpg' });
    expect(r.url).toBe('https://s3.us-east-1.amazonaws.com/cowinance/tenant%20a/archivo%20con%20espacio.jpg');
  });

  it('incluye el token de sesión cuando hay credenciales temporales', () => {
    const r = signS3Request({ ...BASE, sessionToken: 'tok' });
    expect(r.headers['x-amz-security-token']).toBe('tok');
    expect(r.headers.Authorization).toContain('x-amz-security-token');
  });
});

/**
 * URL y `Host` firmado tienen que hablar del MISMO destino.
 *
 * Es la invariante que estaba rota y que nadie veía: la firma usaba el host virtual-hosted
 * (`bucket.endpoint`) y la URL el endpoint pelado, así que contra AWS —el único que usa ese
 * estilo— la request iba a una URL sin bucket y con una firma que no correspondía. Las pruebas de
 * integración corren contra MinIO, que es path-style, así que jamás tocaron esta rama.
 */
describe('estilo de URL: path-style vs virtual-hosted', () => {
  const base = {
    endpoint: 'https://s3.us-east-2.amazonaws.com',
    bucket: 'cowinance-media',
    region: 'us-east-2',
    accessKeyId: 'AKIA',
    secretAccessKey: 'secreto',
    method: 'GET' as const,
    key: 'tenant/foto.jpg',
    now: new Date(0),
  };

  it('virtual-hosted (AWS): el bucket va en el HOST, y la URL apunta ahí', () => {
    const r = signS3Request({ ...base, forcePathStyle: false });
    expect(r.url).toBe('https://cowinance-media.s3.us-east-2.amazonaws.com/tenant/foto.jpg');
    expect(r.headers.host).toBe('cowinance-media.s3.us-east-2.amazonaws.com');
  });

  it('path-style (R2/MinIO/B2): el bucket va en la RUTA', () => {
    const r = signS3Request({ ...base, forcePathStyle: true });
    expect(r.url).toBe('https://s3.us-east-2.amazonaws.com/cowinance-media/tenant/foto.jpg');
    expect(r.headers.host).toBe('s3.us-east-2.amazonaws.com');
  });

  // LA aserción: el host que se firma tiene que ser el host al que se pega. Si divergen, el
  // servidor recalcula la firma sobre otro host y la rechaza — con un error que no dice el motivo.
  it('en los DOS estilos, el host firmado es el de la URL', () => {
    for (const forcePathStyle of [true, false]) {
      const r = signS3Request({ ...base, forcePathStyle });
      expect(new URL(r.url).host).toBe(r.headers.host);
    }
  });

  it('conserva el puerto (MinIO local en virtual-hosted)', () => {
    const r = signS3Request({ ...base, endpoint: 'http://localhost:9010', forcePathStyle: false });
    expect(r.url).toBe('http://cowinance-media.localhost:9010/tenant/foto.jpg');
    expect(new URL(r.url).host).toBe(r.headers.host);
  });
});
