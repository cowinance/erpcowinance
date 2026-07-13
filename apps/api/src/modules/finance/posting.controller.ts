import { Body, Controller, Get, Post, Put } from '@nestjs/common';
import { PostingService } from './posting.service';

@Controller('finance')
export class PostingController {
  constructor(private readonly posting: PostingService) {}

  @Get('posting-accounts')
  getPostingAccounts() {
    return this.posting.getPostingAccounts();
  }
  @Put('posting-accounts')
  setPostingAccounts(@Body() body: any) {
    return this.posting.setPostingAccounts(body);
  }
  @Post('postings')
  postDocument(@Body() body: any) {
    return this.posting.postDocument(body?.kind, body?.document_id);
  }
}
