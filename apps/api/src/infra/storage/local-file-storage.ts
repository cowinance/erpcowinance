import { Injectable, Logger } from '@nestjs/common';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join, resolve, sep } from 'path';
import type { FileStorage } from '../../application/ports/file-storage.port';

/**
 * Adaptador de DESARROLLO: los bytes van al disco del proceso, en `.data/uploads/<tenant>/<file>`.
 * Es exactamente el layout que ya usaban `media` y `documents`, así que una instalación existente
 * sigue encontrando sus archivos sin migrar nada.
 *
 * NO usar con más de una instancia ni sobre disco efímero: la foto que sube una no la sirve la
 * otra, y un redeploy se las lleva. Para eso está el adaptador S3.
 */
@Injectable()
export class LocalFileStorage implements FileStorage {
  readonly kind = 'local';
  private readonly root: string;

  constructor(root = join(process.cwd(), '.data', 'uploads')) {
    this.root = resolve(root);
  }

  async put(key: string, body: Buffer): Promise<void> {
    const path = this.pathFor(key);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, body);
  }

  async get(key: string): Promise<Buffer | null> {
    const path = this.pathFor(key);
    return existsSync(path) ? readFileSync(path) : null;
  }

  /**
   * La clave viene de un token firmado, no del request crudo — pero igual se verifica que resuelva
   * DENTRO de la raíz. Un `..` en una clave sería lectura arbitraria del filesystem, y el costo de
   * descartarlo acá es una comparación de strings.
   */
  private pathFor(key: string): string {
    const path = resolve(this.root, key);
    if (path !== this.root && !path.startsWith(this.root + sep))
      throw new Error(`Clave de archivo fuera de la raíz de almacenamiento: ${key}`);
    return path;
  }
}

/** Log de arranque compartido por los adaptadores. */
export const storageLogger = new Logger('FileStorage');
