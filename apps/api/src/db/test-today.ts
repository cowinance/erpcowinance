import { farmToday, addFarmDays } from '@cowinance/domain';

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
export const TEST_TIME_ZONE = 'America/Argentina/Buenos_Aires';

/** Hoy, como lo ve el sistema bajo prueba. */
export const testToday = (): string => farmToday(TEST_TIME_ZONE);

/** Hoy ± n días, sobre el calendario (no sumando milisegundos: el horario de verano corre la cuenta). */
export const testDay = (n: number): string => addFarmDays(testToday(), n);
