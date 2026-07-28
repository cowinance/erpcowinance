import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { DbService, Q } from '../../db/db.service';
import { HerdService } from '../herd/herd.service';
import { LotsService } from '../herd/lots.service';
import { addFarmDays } from '@cowinance/domain';
import { SAMPLE_HERD, SAMPLE_LOTS, SAMPLE_WEIGHING_DAYS_AGO, secondWeightKg } from './sample-herd';

/**
 * Datos de ejemplo del onboarding (O-3): un hato de muestra para ver la app funcionando.
 *
 * El problema que resuelve: una finca recién creada está vacía, y una app vacía no muestra para qué
 * sirve. El productor ve cero en todos los KPIs, ninguna agenda y ningún gráfico, y tiene que
 * cargar su hato entero antes de poder juzgar si esto le conviene. Con un hato de muestra puede
 * mirar primero y decidir después.
 *
 * **Lo delicado no es crearlo, es sacarlo.** Un animal inventado que sobrevive al borrado entra en
 * el conteo del hato, en los KPIs, en los reportes y en la contabilidad — y se descubre tarde,
 * cuando ya nadie se acuerda de dónde salió. Por eso:
 *
 *  - se ANOTA lo que se crea (`onboarding_sample_rows`) y se borra exactamente eso. El borrado no
 *    adivina por nombre, ni por fecha, ni por prefijo de caravana: si no está anotado, no se toca;
 *  - se crea con los servicios REALES (`HerdService`, `LotsService`), no con SQL a mano, así el
 *    ejemplo es un hato de verdad —con su historial, sus identificadores y su GDP derivada— y no
 *    una imitación que se comporta distinto justo en lo que el productor está evaluando;
 *  - las caravanas llevan `EJ-` adelante: si algo fallara, la diferencia se ve en cualquier
 *    listado en vez de descubrirse cuando no cierra el conteo.
 *
 * Limitación conocida y deliberada: el borrado es un `deleted_at` sin op de sincronización, igual
 * que el resto de los borrados de la app (`deleteWeighing`). Un teléfono que ya se sincronizó con
 * el ejemplo cargado va a seguir mostrándolo hasta que se resincronice de cero. Se acepta porque
 * los datos de ejemplo son de la primera sesión en la web, antes de que haya un teléfono en juego.
 */
@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);

  constructor(
    private readonly db: DbService,
    private readonly herd: HerdService,
    private readonly lots: LotsService,
  ) {}

  /** ¿Hay datos de ejemplo cargados, y cuántos animales quedan vivos? */
  async sampleStatus(): Promise<{ loaded: boolean; animals: number; lots: number }> {
    const r = await this.db.one<{ animals: number; lots: number }>(
      `SELECT
         count(*) FILTER (WHERE kind = 'animal')::int AS animals,
         count(*) FILTER (WHERE kind = 'lot')::int    AS lots
       FROM onboarding_sample_rows WHERE tenant_id = $1`,
      [this.db.tenant],
    );
    const animals = r?.animals ?? 0;
    const lots = r?.lots ?? 0;
    return { loaded: animals + lots > 0, animals, lots };
  }

  /**
   * Carga el hato de ejemplo.
   *
   * No es idempotente a propósito: si ya hay uno cargado, se rechaza en vez de duplicarlo. Dos
   * hatos de ejemplo encima no le sirven a nadie y hacen el borrado más difícil de explicar.
   */
  async loadSample(): Promise<{ animals: number; lots: number }> {
    if ((await this.sampleStatus()).loaded)
      throw new ConflictException({
        code: 'onboarding.sample_already_loaded',
        title: 'Ya hay datos de ejemplo cargados. Quitalos antes de volver a cargarlos.',
      });

    const hoy = await this.db.today();
    const cats = await this.db.query<{ code: string; sex: string | null; min_age_months: number | null }>(
      `SELECT code, sex, min_age_months FROM animal_categories WHERE deleted_at IS NULL ORDER BY code`,
    );
    if (cats.length === 0)
      throw new BadRequestException({ code: 'onboarding.catalogs_missing', title: 'Los catálogos base no están cargados' });

    /** La categoría más específica que el animal ya alcanzó, igual que en la planilla de ejemplo. */
    const categoriaPara = (sexo: 'F' | 'M', meses: number) =>
      cats
        .filter((c) => c.sex === sexo && (c.min_age_months ?? 0) <= meses)
        .sort((a, b) => (b.min_age_months ?? 0) - (a.min_age_months ?? 0))[0]?.code ??
      cats.find((c) => c.sex === sexo)?.code ??
      cats[0].code;

    const lotIdPorNombre = new Map<string, string>();
    for (const nombre of SAMPLE_LOTS) {
      const lote: any = await this.lots.createLot({ name: nombre });
      lotIdPorNombre.set(nombre, lote.id);
      await this.anotar('lot', lote.id);
    }

    for (const a of SAMPLE_HERD) {
      const animal: any = await this.herd.createAnimal({
        tag: a.tag,
        sex: a.sex,
        category_code: categoriaPara(a.sex, a.ageMonths),
        birth_date: addFarmDays(hoy, -Math.round(a.ageMonths * 30.4)),
        lot_id: lotIdPorNombre.get(a.lot),
      });
      await this.anotar('animal', animal.id);

      // Dos pesajes, para que haya GDP: con uno solo no hay de dónde derivarla, y la ganancia
      // diaria es el número por el que el productor juzga si el rodeo anda.
      await this.herd.registerEvent(animal.id, {
        type: 'weighing',
        weight_kg: a.firstWeightKg,
        occurred_at: addFarmDays(hoy, -SAMPLE_WEIGHING_DAYS_AGO[0]),
      });
      await this.herd.registerEvent(animal.id, {
        type: 'weighing',
        weight_kg: secondWeightKg(a),
        occurred_at: addFarmDays(hoy, -SAMPLE_WEIGHING_DAYS_AGO[1]),
      });
    }

    this.logger.log(`Datos de ejemplo cargados: ${SAMPLE_HERD.length} animales, ${SAMPLE_LOTS.length} lotes`);
    return { animals: SAMPLE_HERD.length, lots: SAMPLE_LOTS.length };
  }

  /**
   * Quita los datos de ejemplo. Solo toca lo ANOTADO.
   *
   * Todo pasa en una transacción: media eliminación deja una finca con animales de ejemplo sueltos
   * y sin registro de cuáles eran, que es el peor estado posible — ya no se puede terminar el
   * trabajo automáticamente.
   */
  async removeSample(): Promise<{ animals: number; lots: number; lots_kept: number }> {
    const t = this.db.tenant;
    if (!(await this.sampleStatus()).loaded)
      throw new ConflictException({
        code: 'onboarding.sample_not_loaded',
        title: 'No hay datos de ejemplo cargados.',
      });

    return this.db.tx(async (q: Q) => {
      const anim = (await q.query<{ row_id: string }>(
        `SELECT row_id FROM onboarding_sample_rows WHERE tenant_id = $1 AND kind = 'animal'`,
        [t],
      )).map((r) => r.row_id);
      const lotes = (await q.query<{ row_id: string }>(
        `SELECT row_id FROM onboarding_sample_rows WHERE tenant_id = $1 AND kind = 'lot'`,
        [t],
      )).map((r) => r.row_id);

      // Lo que cuelga de un animal de ejemplo es de ejemplo: se va con él. Si el productor le
      // anotó algo propio a un animal de muestra, se va también — el animal deja de existir, así
      // que un pesaje suyo huérfano sería un dato sin sujeto.
      if (anim.length) {
        for (const tabla of ['weighings', 'animal_events', 'animal_identifiers', 'animal_breeds'])
          await q.query(
            `UPDATE ${tabla} SET deleted_at = now() WHERE tenant_id = $1 AND animal_id = ANY($2::uuid[]) AND deleted_at IS NULL`,
            [t, anim],
          );
        await q.query(`UPDATE animals SET deleted_at = now() WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND deleted_at IS NULL`, [
          t,
          anim,
        ]);
      }

      // Los lotes SOLO si quedaron vacíos. Si el productor movió un animal suyo a un lote de
      // ejemplo, borrarlo lo dejaría sin lote: se conserva el lote y se le avisa. Prefiero
      // devolverle un lote de más que dejarle un animal sin grupo.
      let lotsBorrados = 0;
      let lotsConservados = 0;
      for (const lote of lotes) {
        const ocupado = await q.one<{ n: number }>(
          `SELECT count(*)::int AS n FROM animals WHERE tenant_id = $1 AND current_lot_id = $2 AND deleted_at IS NULL`,
          [t, lote],
        );
        if ((ocupado?.n ?? 0) > 0) {
          lotsConservados++;
          continue;
        }
        await q.query(`UPDATE lots SET deleted_at = now() WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`, [t, lote]);
        lotsBorrados++;
      }

      await q.query(`DELETE FROM onboarding_sample_rows WHERE tenant_id = $1`, [t]);

      this.logger.log(`Datos de ejemplo quitados: ${anim.length} animales, ${lotsBorrados} lotes (${lotsConservados} conservados)`);
      return { animals: anim.length, lots: lotsBorrados, lots_kept: lotsConservados };
    });
  }

  /** Anota una fila raíz creada por el ejemplo. Es lo único de lo que depende el borrado. */
  private async anotar(kind: 'animal' | 'lot', rowId: string): Promise<void> {
    await this.db.query(`INSERT INTO onboarding_sample_rows (tenant_id, kind, row_id) VALUES ($1,$2,$3)`, [
      this.db.tenant,
      kind,
      rowId,
    ]);
  }
}
