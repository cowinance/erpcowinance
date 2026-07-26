import { DbService } from '../../db/db.service';
import { CostingService } from '../costing/costing.service';
import { InventoryService } from '../inventory/inventory.service';
import { MachineryService } from '../machinery/machinery.service';
import { CropsService } from '../agriculture/crops.service';
import { GrazingService } from '../grazing/grazing.service';
import { WeatherService } from '../weather/weather.service';
import { ReportsService } from './reports.service';

/**
 * Arma `ReportsService` con sus colaboradores reales, para los tests.
 *
 * Existe porque el resumen de la finca (Fase 5) COMPONE los servicios de los verticales en vez de
 * repetir sus consultas, y eso le da un constructor largo. Sin este armador, cada test que solo
 * quiere probar un reporte viejo tendría su propia copia de la construcción, y agregar un vertical
 * al resumen rompería tres archivos que no tienen nada que ver con el cambio.
 *
 * Se instancian los servicios de verdad y no dobles: lo que este reporte promete es que sus números
 * son los MISMOS que los de cada módulo. Con mocks esa promesa no se estaría probando.
 */
export function buildReportsService(db: DbService): ReportsService {
  const inventory = new InventoryService(db);
  return new ReportsService(
    db,
    new CostingService(db),
    inventory,
    new MachineryService(db),
    new CropsService(db),
    new GrazingService(db, new WeatherService(db)),
  );
}
