import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { SyncController } from './sync.controller';
import { SyncService } from './sync.service';

@Module({ imports: [BillingModule], controllers: [SyncController], providers: [SyncService] })
export class SyncModule {}
