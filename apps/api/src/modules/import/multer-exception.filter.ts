import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { MulterError } from 'multer';

export const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB

/**
 * Traduce los `MulterError` (que se lanzan en la recepción del multipart, antes
 * del handler) a la forma de error de dominio del proyecto ({ code, title }).
 * Sin este filtro, Nest los emitiría como 500 genérico. Scoped al controller de
 * import (no global).
 */
@Catch(MulterError)
export class MulterExceptionFilter implements ExceptionFilter {
  catch(err: MulterError, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    if (err.code === 'LIMIT_FILE_SIZE') {
      res.status(HttpStatus.PAYLOAD_TOO_LARGE).json({
        code: 'import.file_too_large',
        title: `El archivo supera el máximo de ${MAX_FILE_BYTES / (1024 * 1024)} MB`,
      });
      return;
    }
    // LIMIT_FILE_COUNT / LIMIT_PART_COUNT / LIMIT_FIELD_* / LIMIT_UNEXPECTED_FILE …
    res.status(HttpStatus.BAD_REQUEST).json({
      code: 'import.upload_rejected',
      title: `Subida rechazada (${err.code})`,
    });
  }
}
