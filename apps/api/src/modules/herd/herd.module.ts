import { Module } from '@nestjs/common';
import { HerdController } from './herd.controller';
import { HerdService } from './herd.service';
import { WeighingSyncHandler } from './sync/weighing-sync.handler';

@Module({ controllers: [HerdController], providers: [HerdService, WeighingSyncHandler] })
export class HerdModule {}
