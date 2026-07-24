import { Injectable } from '@nestjs/common';
import type { FileStorage } from '../../application/ports/file-storage.port';
import { signS3Request } from './s3-signer';

export interface S3Config {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  forcePathStyle: boolean;
}

/**
 * Almacenamiento de objetos compatible con S3 (AWS, Cloudflare R2, MinIO, Backblaze B2).
 * Es el adaptador de PRODUCCIÓN: los bytes dejan de vivir en el disco del contenedor, así que
 * sobreviven a un deploy y los ve cualquier instancia.
 *
 * Habla HTTP directo con `fetch` + firma SigV4 (ver `s3-signer.ts`): no hay SDK de por medio.
 */
@Injectable()
export class S3FileStorage implements FileStorage {
  readonly kind = 's3';

  constructor(private readonly config: S3Config) {}

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    const res = await this.send('PUT', key, body, contentType);
    if (!res.ok) throw new Error(await this.errorOf('guardar', key, res));
  }

  async get(key: string): Promise<Buffer | null> {
    const res = await this.send('GET', key);
    // 404 no es un error del almacén: es "esa clave no existe", y quien llama decide qué hacer.
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(await this.errorOf('leer', key, res));
    return Buffer.from(await res.arrayBuffer());
  }

  private send(method: 'GET' | 'PUT', key: string, payload?: Buffer, contentType?: string) {
    const { url, headers } = signS3Request({
      method,
      key,
      payload,
      contentType,
      now: new Date(),
      ...this.config,
    });
    return fetch(url, { method, headers, body: payload as BodyInit | undefined });
  }

  /** El cuerpo del error de S3 es XML con el motivo real; sin él, un 403 no dice nada. */
  private async errorOf(accion: string, key: string, res: Response): Promise<string> {
    const detail = await res.text().catch(() => '');
    return `No se pudo ${accion} el objeto "${key}" en S3 (${res.status} ${res.statusText}). ${detail.slice(0, 300)}`;
  }
}

/**
 * Lee la configuración del entorno. Falla ruidosamente si falta algo: un almacén de objetos mal
 * configurado que arranca igual solo posterga el descubrimiento hasta la primera foto que suba
 * un usuario.
 */
export function s3ConfigFromEnv(env: NodeJS.ProcessEnv = process.env): S3Config {
  const required = ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const;
  const missing = required.filter((k) => !env[k]?.trim());
  if (missing.length > 0)
    throw new Error(`STORAGE_DRIVER=s3 pero faltan variables: ${missing.join(', ')}. Ver .env.example.`);

  return {
    endpoint: env.S3_ENDPOINT!.trim(),
    bucket: env.S3_BUCKET!.trim(),
    region: env.S3_REGION?.trim() || 'auto',
    accessKeyId: env.S3_ACCESS_KEY_ID!.trim(),
    secretAccessKey: env.S3_SECRET_ACCESS_KEY!.trim(),
    sessionToken: env.S3_SESSION_TOKEN?.trim() || undefined,
    // Path-style por defecto: R2, MinIO y B2 lo exigen. AWS S3 usa virtual-hosted
    // (`S3_FORCE_PATH_STYLE=false`).
    forcePathStyle: env.S3_FORCE_PATH_STYLE?.trim().toLowerCase() !== 'false',
  };
}
