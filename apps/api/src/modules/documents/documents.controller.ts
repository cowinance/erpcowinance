import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { DocumentsService } from './documents.service';

/** Documentos y archivos (A6): DMS formal con tipo, vigencia y vencimiento. Descarga vía /files/:id/content. */
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get()
  list(@Query('type') type?: string, @Query('expiring') expiring?: string, @Query('entity_type') entityType?: string, @Query('entity_id') entityId?: string) {
    return this.documents.list({ type, expiring, entity_type: entityType, entity_id: entityId });
  }

  @Get('summary')
  summary() {
    return this.documents.summary();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.documents.get(id);
  }

  @Post()
  create(@Body() body: any) {
    return this.documents.create(body);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.documents.remove(id);
  }
}
