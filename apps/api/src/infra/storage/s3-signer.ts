import { createHash, createHmac } from 'crypto';

/**
 * Firma AWS Signature V4 para S3, escrita a mano.
 *
 * POR QUÉ NO EL SDK: `@aws-sdk/client-s3` arrastra decenas de paquetes transitivos para lo que acá
 * son tres operaciones sobre HTTP (PUT, GET). SigV4 es un algoritmo cerrado y determinista —hash,
 * HMAC y concatenación de strings— y el repositorio ya resuelve así lo que puede resolver así
 * (hash de contraseñas, rate limit, cabeceras de seguridad). El precio de equivocarse es ruidoso,
 * no silencioso: el servidor rechaza la firma y la subida falla.
 *
 * Sirve para cualquier almacén compatible con S3: AWS, Cloudflare R2, MinIO, Backblaze B2.
 */
export interface SignedRequest {
  url: string;
  headers: Record<string, string>;
}

export interface S3SignParams {
  method: 'GET' | 'PUT' | 'DELETE' | 'HEAD';
  /** Endpoint sin bucket ni clave: `https://s3.amazonaws.com` o `http://minio:9000`. */
  endpoint: string;
  bucket: string;
  /** Clave del objeto, sin barra inicial. */
  key: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Cuerpo de la request (vacío en GET). */
  payload?: Buffer;
  contentType?: string;
  /** Credenciales temporales (STS). */
  sessionToken?: string;
  /**
   * `true` → `https://endpoint/bucket/key` (R2, MinIO y B2 lo exigen).
   * `false` → `https://bucket.endpoint/key` (el estilo actual de AWS S3).
   */
  forcePathStyle: boolean;
  /** Inyectable para que la firma sea reproducible en los tests. */
  now: Date;
}

const ALGORITHM = 'AWS4-HMAC-SHA256';
const SERVICE = 's3';

export function signS3Request(p: S3SignParams): SignedRequest {
  const payload = p.payload ?? Buffer.alloc(0);
  const payloadHash = sha256Hex(payload);
  const { amzDate, dateStamp } = timestamps(p.now);

  const endpoint = new URL(p.endpoint);
  const host = p.forcePathStyle ? endpoint.host : `${p.bucket}.${endpoint.host}`;
  const path = p.forcePathStyle ? `/${p.bucket}/${encodeKey(p.key)}` : `/${encodeKey(p.key)}`;

  // Las cabeceras firmadas van en minúscula y ORDENADAS: la firma es sobre esa forma canónica
  // exacta, así que cualquier diferencia de orden o de mayúsculas produce otra firma.
  const headers: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  if (p.contentType) headers['content-type'] = p.contentType;
  if (p.sessionToken) headers['x-amz-security-token'] = p.sessionToken;

  const signedHeaders = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaders.map((h) => `${h}:${headers[h].trim()}\n`).join('');
  const signedHeadersList = signedHeaders.join(';');

  const canonicalRequest = [
    p.method,
    path,
    '', // sin query string
    canonicalHeaders,
    signedHeadersList,
    payloadHash,
  ].join('\n');

  const scope = `${dateStamp}/${p.region}/${SERVICE}/aws4_request`;
  const stringToSign = [ALGORITHM, amzDate, scope, sha256Hex(Buffer.from(canonicalRequest, 'utf8'))].join('\n');

  const signature = hmac(signingKey(p.secretAccessKey, dateStamp, p.region), stringToSign).toString('hex');

  return {
    url: `${endpoint.origin}${path}`,
    headers: {
      ...headers,
      Authorization: `${ALGORITHM} Credential=${p.accessKeyId}/${scope}, SignedHeaders=${signedHeadersList}, Signature=${signature}`,
    },
  };
}

/** La clave se codifica por SEGMENTO: las barras separan y no deben escaparse. */
function encodeKey(key: string): string {
  return key
    .split('/')
    .map((segment) => encodeURIComponent(segment).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase()))
    .join('/');
}

function timestamps(now: Date): { amzDate: string; dateStamp: string } {
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

function sha256Hex(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

/** Clave de firma derivada en cadena: fecha → región → servicio → aws4_request. */
function signingKey(secret: string, dateStamp: string, region: string): Buffer {
  const kDate = hmac(`AWS4${secret}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, SERVICE);
  return hmac(kService, 'aws4_request');
}
