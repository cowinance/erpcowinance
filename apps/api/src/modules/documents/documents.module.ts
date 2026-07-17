import { Module } from '@nestjs/common';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';

/**
 * Documentos, archivos y media (A6): el DMS del ERP. Documentos formales sobre `documents`/`files`,
 * con vencimiento derivado y enlace polimórfico. Bounded context propio; comparte el almacén de
 * archivos y el servido por token con el módulo media.
 */
@Module({
  controllers: [DocumentsController],
  providers: [DocumentsService],
})
export class DocumentsModule {}
