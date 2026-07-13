import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CommerceService } from './commerce.service';

@Controller('commerce')
export class CommerceController {
  constructor(private readonly commerce: CommerceService) {}

  @Get('partners')
  partners(@Query('type') type?: string) {
    return this.commerce.listPartners(type);
  }
  @Get('partners/:id')
  partner(@Param('id') id: string) {
    return this.commerce.getPartner(id);
  }
  @Post('partners')
  createPartner(@Body() body: any) {
    return this.commerce.createPartner(body);
  }
  @Patch('partners/:id')
  updatePartner(@Param('id') id: string, @Body() body: any) {
    return this.commerce.updatePartner(id, body);
  }
  @Delete('partners/:id')
  deletePartner(@Param('id') id: string) {
    return this.commerce.deletePartner(id);
  }

  @Post('partners/:id/contacts')
  createContact(@Param('id') id: string, @Body() body: any) {
    return this.commerce.createContact(id, body);
  }
  @Delete('contacts/:id')
  deleteContact(@Param('id') id: string) {
    return this.commerce.deleteContact(id);
  }
}
