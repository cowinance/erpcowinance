import { farmToday, addFarmDays } from '@cowinance/domain';
import { countryDefaults } from '../modules/identity/country-defaults';

/**
 * El «hoy» que tienen que usar los FIXTURES de los tests.
 *
 * Un test que siembra `new Date().toISOString().slice(0, 10)` está fechando en UTC, mientras el
 * sistema razona en la zona de la finca. Entre las 00:00 y las 03:00 UTC son días distintos, y ahí
 * el test empieza a fallar sin que nadie haya tocado el código: pasa en CI de mañana y explota de
 * noche. Es peor que un test que falla siempre, porque nadie sabe a qué culpar.
 *
 * La zona del demo es la de su organización; los tests la reciben ya aplicada en la sesión de base
 * (ver `DbService.onModuleInit`), así que acá se usa la misma para que fixture y sistema coincidan.
 */
/**
 * DERIVADA del país de la demo, no escrita a mano.
 *
 * Estaba clavada en `America/Argentina/Buenos_Aires` mientras el seed decía Argentina. Cuando la
 * demo pasó a Venezuela —que es el país del producto— esta constante quedó atrás, y las dos zonas
 * discrepan una hora por día: entre las 23:00 y las 00:00 de Caracas, Buenos Aires ya está en el día
 * siguiente. Doce tests cayeron de golpe, todos de fecha, y ninguno señalaba la causa.
 *
 * Es el bug que el comentario de arriba describe, cometido en el archivo que existe para evitarlo:
 * el fixture fechando en una zona y el sistema razonando en otra. Que salga de `countryDefaults` —la
 * misma fuente que usa el seed— es lo que hace que no pueda volver a separarse en silencio.
 */
export const TEST_TIME_ZONE = countryDefaults('VE').timezone;

/** Hoy, como lo ve el sistema bajo prueba. */
export const testToday = (): string => farmToday(TEST_TIME_ZONE);

/** Hoy ± n días, sobre el calendario (no sumando milisegundos: el horario de verano corre la cuenta). */
export const testDay = (n: number): string => addFarmDays(testToday(), n);
