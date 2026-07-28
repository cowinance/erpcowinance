import { BadRequestException, Body, Controller, Get, Param, Post, Put, Query, UploadedFile, UseFilters, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ImportService } from './import.service';
import { MAX_FILE_BYTES, MulterExceptionFilter } from './multer-exception.filter';

/**
 * Límites explícitos de Multer para la subida (defensa complementaria; el fix de
 * los advisories de DoS es multer 2.2.0). `fieldNestingDepth` es un límite real
 * de multer 2.2.0 que el tipo `MulterOptions` de Nest no lista; se pasa vía const
 * (no literal fresco) para que llegue a multer en runtime sin romper el typecheck.
 */
const IMPORT_UPLOAD_LIMITS = {
  fileSize: MAX_FILE_BYTES, // 5 MB
  files: 1, // exactamente un archivo
  parts: 6,
  fields: 4,
  fieldNameSize: 100,
  fieldSize: 1024,
  headerPairs: 20,
  fieldNestingDepth: 1, // campos planos
};

@Controller()
@UseFilters(MulterExceptionFilter)
export class ImportController {
  constructor(private readonly imports: ImportService) {}

  /**
   * POST /v1/imports — carga multipart de un CSV. Campo de archivo fijo `file`,
   * `entity_type` limitado a `animal`, almacenamiento en memoria (sin temporales
   * ni persistencia de bytes: el buffer se parsea y se descarta). Crea el batch
   * en estado `uploaded` con sus filas.
   */
  @Post('imports')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: IMPORT_UPLOAD_LIMITS }))
  async create(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('entity_type') entityType?: string,
  ) {
    if (!file) {
      throw new BadRequestException({ code: 'import.file_required', title: "Falta la parte de archivo 'file'" });
    }
    if (file.size === 0 || file.buffer.length === 0) {
      throw new BadRequestException({ code: 'import.empty_file', title: 'El archivo está vacío' });
    }
    const content = file.buffer.toString('utf8');
    return this.imports.createFromCsv(entityType ?? '', file.originalname ?? null, content);
  }

  /** Catálogo de campos del descriptor para la UI de mapeo (3 segmentos → no colisiona con `imports/:id`). */
  @Get('imports/:entityType/fields')
  fields(@Param('entityType') entityType: string) {
    return this.imports.listFields(entityType);
  }

  /** Datos de la planilla de ejemplo (3 segmentos, igual que `fields` → no colisiona con `:id`). */
  @Get('imports/:entityType/template')
  template(@Param('entityType') entityType: string) {
    return this.imports.templateRows(entityType);
  }

  @Get('imports/:id')
  get(@Param('id') id: string) {
    return this.imports.getBatch(id);
  }

  @Get('imports/:id/rows')
  rows(@Param('id') id: string, @Query('cursor') cursor?: string, @Query('limit') limit?: string) {
    return this.imports.listRows(id, cursor, limit ? Number(limit) : undefined);
  }

  @Put('imports/:id/mapping')
  updateMapping(@Param('id') id: string, @Body('mapping') mapping: unknown) {
    return this.imports.updateMapping(id, mapping);
  }

  @Post('imports/:id/preview')
  preview(@Param('id') id: string) {
    return this.imports.preview(id);
  }

  @Post('imports/:id/commit')
  commit(@Param('id') id: string) {
    return this.imports.commit(id);
  }
}
