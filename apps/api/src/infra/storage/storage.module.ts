import { Global, Logger, Module } from '@nestjs/common';
import { FILE_STORAGE, type FileStorage } from '../../application/ports/file-storage.port';
import { LocalFileStorage } from './local-file-storage';
import { S3FileStorage, s3ConfigFromEnv } from './s3-file-storage';

/**
 * Infra de archivos, `@Global` como `EmailModule` y `EventBusModule`: expone el puerto
 * `FILE_STORAGE`; los servicios inyectan el token, nunca el adaptador concreto.
 *
 * El adaptador se elige por `STORAGE_DRIVER` (`local` por defecto, mismo estilo que
 * `EMAIL_PROVIDER`). Falla ruidosamente si se pide uno que no existe: un typo no debe degradar
 * silenciosamente a disco local y perder las fotos en el próximo deploy.
 */
@Global()
@Module({
  providers: [
    {
      provide: FILE_STORAGE,
      useFactory: (): FileStorage => {
        const driver = process.env.STORAGE_DRIVER?.trim().toLowerCase() || 'local';
        const logger = new Logger('FileStorage');
        switch (driver) {
          case 'local':
            if (process.env.NODE_ENV === 'production')
              logger.warn(
                'STORAGE_DRIVER=local en producción: los archivos van al disco del proceso y se ' +
                  'pierden en el próximo deploy. Configurá STORAGE_DRIVER=s3.',
              );
            logger.log('Archivos: disco local (.data/uploads)');
            return new LocalFileStorage();
          case 's3': {
            const config = s3ConfigFromEnv();
            logger.log(`Archivos: S3 (${config.endpoint}, bucket ${config.bucket})`);
            return new S3FileStorage(config);
          }
          default:
            throw new Error(`STORAGE_DRIVER desconocido: "${driver}". Adaptadores disponibles: local, s3`);
        }
      },
    },
  ],
  exports: [FILE_STORAGE],
})
export class StorageModule {}
