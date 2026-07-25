import { Module } from '@nestjs/common';
import { WeatherController } from './weather.controller';
import { WeatherService } from './weather.service';

@Module({
  controllers: [WeatherController],
  providers: [WeatherService],
  exports: [WeatherService], // AlertsService deriva de acá las alertas de clima (D4 · E2).
})
export class WeatherModule {}
