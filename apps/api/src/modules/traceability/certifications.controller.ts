import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CertificationsService } from './certifications.service';

@Controller('traceability/certifications')
export class CertificationsController {
  constructor(private readonly certifications: CertificationsService) {}

  @Get()
  list(@Query('entity_type') entityType?: string, @Query('entity_id') entityId?: string) {
    return this.certifications.list(entityType, entityId);
  }
  @Get(':id')
  get(@Param('id') id: string) {
    return this.certifications.get(id);
  }
  @Post()
  create(@Body() body: any) {
    return this.certifications.create(body);
  }
  @Patch(':id/status')
  updateStatus(@Param('id') id: string, @Body() body: any) {
    return this.certifications.updateStatus(id, body?.status);
  }
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.certifications.remove(id);
  }
}
