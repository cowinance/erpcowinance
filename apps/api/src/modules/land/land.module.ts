import { Module } from '@nestjs/common';
import { LandController } from './land.controller';
import { LandService } from './land.service';

@Module({ controllers: [LandController], providers: [LandService] })
export class LandModule {}
