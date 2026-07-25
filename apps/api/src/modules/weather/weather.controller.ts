import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import type { ProductionSystem } from '@cowinance/domain';
import { WeatherService, type RangeParams } from './weather.service';

@Controller('weather')
export class WeatherController {
  constructor(private readonly weather: WeatherService) {}

  @Get('stations')
  stations() {
    return this.weather.stations();
  }

  @Post('stations')
  createStation(@Body() body: any) {
    return this.weather.createStation(body);
  }

  /** Carga de mediciones: la usa tanto una estación que vuelca por tandas como el parte manual. */
  @Post('readings')
  ingest(@Body() body: any) {
    return this.weather.ingest(body);
  }

  @Get('daily')
  daily(@Query() q: Record<string, string>) {
    return this.weather.daily(rangeFrom(q));
  }

  @Get('summary')
  summary(@Query() q: Record<string, string>) {
    return this.weather.summary(rangeFrom(q));
  }
}

/** Un solo lugar traduce query params a parámetros del servicio. */
function rangeFrom(q: Record<string, string>): RangeParams {
  const num = (v?: string) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined);
  return {
    from: q.from || undefined,
    to: q.to || undefined,
    stationId: q.station_id || undefined,
    // El servicio decide el default; acá solo se acepta lo que el dominio conoce.
    system: q.system === 'dairy' || q.system === 'beef' ? (q.system as ProductionSystem) : undefined,
    gddBase: num(q.gdd_base),
    gddCap: num(q.gdd_cap),
    frostThresholdC: num(q.frost_threshold),
  };
}
