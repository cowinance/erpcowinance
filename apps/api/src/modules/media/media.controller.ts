import { Body, Controller, Delete, Get, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { MediaService } from './media.service';
import { Public } from '../auth/public.decorator';

@Controller()
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Post('animals/:id/photos')
  upload(@Param('id') id: string, @Body() body: any) {
    return this.media.uploadAnimalPhoto(id, body);
  }

  @Get('animals/:id/photos')
  list(@Param('id') id: string) {
    return this.media.listAnimalPhotos(id);
  }

  @Post('animals/:id/photos/:fileId/primary')
  setPrimary(@Param('id') id: string, @Param('fileId') fileId: string) {
    return this.media.setPrimary(id, fileId);
  }

  @Delete('animals/:id/photos/:fileId')
  remove(@Param('id') id: string, @Param('fileId') fileId: string) {
    return this.media.deletePhoto(id, fileId);
  }

  /** Servido con URL firmada — público (el token porta tenant + mime). */
  @Public()
  @Get('files/:id/content')
  async content(@Param('id') id: string, @Query('t') token: string, @Res() res: Response) {
    const { buffer, mime } = await this.media.serve(id, token);
    res.set({ 'Content-Type': mime, 'Cache-Control': 'private, max-age=3600' });
    res.send(buffer);
  }
}
