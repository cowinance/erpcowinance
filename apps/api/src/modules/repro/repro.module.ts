import { Module } from '@nestjs/common';
import { ReproController } from './repro.controller';
import { ReproService } from './repro.service';

@Module({ controllers: [ReproController], providers: [ReproService] })
export class ReproModule {}
