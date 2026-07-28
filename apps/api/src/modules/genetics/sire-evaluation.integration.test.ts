import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { SireEvaluationService } from './sire-evaluation.service';

/**
 * Evaluación de toros sobre la base real (Fase 2.3).
 *
 * Lo que se fija acá no es que el número salga, sino que salga por las razones correctas: que el
 * ajuste neutralice la edad al destete, que el grupo contemporáneo aísle el año, y que los datos
 * flojos se informen en vez de diluirse en un promedio que parece sólido.
 */
describe('genética — evaluación de toros por la progenie', () => {
  let db: DbService;
  let svc: SireEvaluationService;
  let originalCwd: string;
  let tmp: string;
  let farmId: string;
  let speciesId: string;
  let toroA: string;
  let toroB: string;
  let madre: string;

  /** Crea un ternero destetado, con su parto, peso al nacer y destete. */
  const cria = async (o: {
    sire: string;
    sex: 'M' | 'F';
    nacidoHaceDias: number;
    destetadoADias: number;
    destetaKg: number;
    naceKg?: number | null;
    dam?: string | null;
  }) => {
    const dam = o.dam === undefined ? madre : o.dam;
    const [{ id }] = await db.query<any>(
      `INSERT INTO animals (tenant_id, farm_id, species_id, sex, status, birth_date, dam_id, sire_id)
       VALUES ($1,$2,$3,$4,'active', CURRENT_DATE - $5::int, $6, $7) RETURNING id`,
      [db.tenant, farmId, speciesId, o.sex, o.nacidoHaceDias, dam, o.sire],
    );
    if (o.naceKg !== null) {
      const [{ id: calving }] = await db.query<any>(
        `INSERT INTO calvings (tenant_id, dam_id, calving_date, offspring_count) VALUES ($1,$2, CURRENT_DATE - $3::int, 1) RETURNING id`,
        [db.tenant, dam, o.nacidoHaceDias],
      );
      await db.query(`INSERT INTO calving_offspring (tenant_id, calving_id, animal_id, birth_weight_kg) VALUES ($1,$2,$3,$4)`, [
        db.tenant,
        calving,
        id,
        o.naceKg ?? 35,
      ]);
    }
    await db.query(
      `INSERT INTO weanings (tenant_id, animal_id, weaning_date, weaning_weight_kg, dam_id)
       VALUES ($1,$2, CURRENT_DATE - $3::int, $4, $5)`,
      [db.tenant, id, o.nacidoHaceDias - o.destetadoADias, o.destetaKg, dam],
    );
    return id;
  };

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'sire-eval-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'off';
    db = new DbService();
    await db.onModuleInit();
    svc = new SireEvaluationService(db);

    const org = (await db.query<any>(`INSERT INTO organizations (name, country_code, default_currency) VALUES ('Cabaña Test','VE','USD') RETURNING id`))[0].id;
    (db as any).tenantId = org;
    speciesId = (await db.query<any>(`SELECT id FROM species LIMIT 1`))[0].id;
    const company = (await db.query<any>(`INSERT INTO companies (tenant_id, name, country_code, functional_currency) VALUES ($1,'C','VE','USD') RETURNING id`, [org]))[0].id;
    farmId = (await db.query<any>(`INSERT INTO farms (tenant_id, company_id, name) VALUES ($1,$2,'F') RETURNING id`, [org, company]))[0].id;

    const toro = async (n: string) =>
      (
        await db.query<any>(
          `INSERT INTO animals (tenant_id, farm_id, species_id, sex, status, name, birth_date) VALUES ($1,$2,$3,'M','active',$4, CURRENT_DATE - 2000) RETURNING id`,
          [org, farmId, speciesId, n],
        )
      )[0].id;
    toroA = await toro('Sansão');
    toroB = await toro('Nelore 4421');
    // Madre adulta (8 años): tramo sin ajuste, para que el test aísle el efecto del padre.
    madre = (
      await db.query<any>(
        `INSERT INTO animals (tenant_id, farm_id, species_id, sex, status, birth_date) VALUES ($1,$2,$3,'F','active', CURRENT_DATE - 2920) RETURNING id`,
        [org, farmId, speciesId],
      )
    )[0].id;
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('sin destetes no inventa una evaluación', async () => {
    const r = await svc.bySire();
    expect(r.sires).toEqual([]);
    expect(r.group_size).toBe(0);
  });

  it('el toro cuyos hijos crecen más queda por encima de 100', async () => {
    for (let i = 0; i < 4; i++)
      await cria({ sire: toroA, sex: 'M', nacidoHaceDias: 300, destetadoADias: 90, destetaKg: 220, naceKg: 36 });
    for (let i = 0; i < 4; i++)
      await cria({ sire: toroB, sex: 'M', nacidoHaceDias: 300, destetadoADias: 90, destetaKg: 180, naceKg: 36 });

    const r = await svc.bySire();
    const a = r.sires.find((s) => s.sireId === toroA)!;
    const b = r.sires.find((s) => s.sireId === toroB)!;
    expect(a.index).toBeGreaterThan(100);
    expect(b.index).toBeLessThan(100);
    expect(a.sire_name).toBe('Sansão');
    expect(r.group_size).toBe(8);
  });

  it('EL AJUSTE NEUTRALIZA LA EDAD: un ternero destetado más viejo no infla a su padre', async () => {
    // Es la prueba que justifica todo el módulo. Dos terneros con la MISMA ganancia diaria pero
    // distinta edad al destete: sin ajustar, el más viejo pesa más y su padre parecería mejor.
    const gordo = await svc.bySire();
    const antes = gordo.sires.find((s) => s.sireId === toroB)!.index;

    // Un hijo de B destetado 60 días más tarde: pesa más, pero creció igual.
    await cria({ sire: toroB, sex: 'M', nacidoHaceDias: 360, destetadoADias: 90, destetaKg: 180, naceKg: 36 });
    const despues = await svc.bySire();
    const b = despues.sires.find((s) => s.sireId === toroB)!;
    // El índice de B no debería saltar: el peso extra era edad, no genética.
    expect(Math.abs(b.index - antes)).toBeLessThanOrEqual(3);
  });

  it('informa cuántos terneros tienen datos incompletos en vez de esconderlo', async () => {
    await cria({ sire: toroA, sex: 'F', nacidoHaceDias: 300, destetadoADias: 90, destetaKg: 200, naceKg: null });
    const r = await svc.bySire();
    expect(r.incomplete).toBeGreaterThan(0);
  });

  it('la confianza acompaña al número: con pocos hijos, baja', async () => {
    const r = await svc.bySire();
    for (const s of r.sires) expect(s.confidence).toBe('baja'); // menos de 10 hijos cada uno
  });

  it('descarta un destete con fecha anterior al nacimiento, y lo cuenta', async () => {
    // Dato imposible: sin este filtro, una edad negativa daría una ganancia diaria negativa y
    // arrastraría el promedio del grupo sin que nadie lo note.
    //
    // La cría mala va en la MISMA parición que el grupo (300 días, como el resto del fixture): los
    // descartes se cuentan por año evaluado, igual que el resto de la respuesta. Contarlos sobre
    // toda la historia —como se hacía antes— ponía un número de otro período al lado de un grupo de
    // uno solo, y el productor no tenía cómo saber a cuál pertenecía.
    const malo = (
      await db.query<any>(
        `INSERT INTO animals (tenant_id, farm_id, species_id, sex, status, birth_date, sire_id, dam_id)
         VALUES ($1,$2,$3,'M','active', CURRENT_DATE - 300, $4, $5) RETURNING id`,
        [db.tenant, farmId, speciesId, toroA, madre],
      )
    )[0].id;
    await db.query(`INSERT INTO weanings (tenant_id, animal_id, weaning_date, weaning_weight_kg) VALUES ($1,$2, CURRENT_DATE - 400, 190)`, [db.tenant, malo]);
    const r = await svc.bySire();
    expect(r.discarded).toBeGreaterThan(0);
  });

  it('el grupo contemporáneo aísla el año: los de otra parición no se mezclan', async () => {
    const r = await svc.bySire();
    const anioActual = r.year!;
    // Un ternero de tres años atrás no debe entrar en el grupo del año evaluado.
    await cria({ sire: toroA, sex: 'M', nacidoHaceDias: 1200, destetadoADias: 90, destetaKg: 300, naceKg: 36 });
    const despues = await svc.bySire();
    expect(despues.year).toBe(anioActual);
    expect(despues.available_years.length).toBeGreaterThan(1);
    // Con 300 kg ese ternero habría disparado el índice de A si se hubiera colado.
    expect(despues.sires.find((s) => s.sireId === toroA)!.index).toBeLessThan(130);
  });

  describe('la carrera del toro, no una temporada', () => {
    /** Cría con año de nacimiento explícito, para armar pariciones distintas. */
    const criaDeAnio = async (anio: number, sire: string, sexo: string, destetaKg: number, i: number) => {
      const [{ id }] = await db.query<any>(
        `INSERT INTO animals (tenant_id, farm_id, species_id, sex, status, birth_date, sire_id)
         VALUES ($1,$2,$3,$4,'active', $5::date, $6) RETURNING id`,
        [db.tenant, farmId, speciesId, sexo, `${anio}-03-1${i}`, sire],
      );
      await db.query(
        `INSERT INTO weanings (tenant_id, animal_id, weaning_date, weaning_weight_kg) VALUES ($1,$2,$3::date,$4)`,
        [db.tenant, id, `${anio}-10-1${i}`, destetaKg],
      );
      return id;
    };

    let toroX: string;
    let toroY: string;

    beforeAll(async () => {
      [{ id: toroX }] = await db.query<any>(
        `INSERT INTO animals (tenant_id, farm_id, species_id, sex, status) VALUES ($1,$2,$3,'M','active') RETURNING id`,
        [db.tenant, farmId, speciesId],
      );
      [{ id: toroY }] = await db.query<any>(
        `INSERT INTO animals (tenant_id, farm_id, species_id, sex, status) VALUES ($1,$2,$3,'M','active') RETURNING id`,
        [db.tenant, farmId, speciesId],
      );
      // Tres pariciones VIEJAS a propósito: si fueran las más recientes se volverían el «año por
      // defecto» de `bySire()` y le cambiarían el grupo a todos los demás tests del archivo.
      // X siempre 8 kg por encima, Y por debajo. En 2016 TODOS suman 40 kg: es el «año bueno» que
      // sirve para comprobar que no le mejora el índice a nadie.
      for (const [anio, base] of [
        [2014, 180],
        [2015, 175],
        [2016, 215],
      ] as const)
        for (const [toro, delta] of [
          [toroX, 8],
          [toroY, -8],
        ] as const)
          for (let i = 0; i < 6; i++) await criaDeAnio(anio, toro, i % 2 ? 'F' : 'M', base + delta + i, i);
    }, 120_000);

    it('LA CONFIANZA SUBE AL SUMAR TEMPORADAS — el motivo de la vista', async () => {
      // Con 6 terneros por parición la confianza es «baja» y no alcanza para decidir una compra.
      // Los mismos animales, sumadas las tres temporadas, dan «media».
      const unaTemporada: any = await svc.bySire({ year: 2016 });
      const a1 = unaTemporada.sires.find((x: any) => x.sireId === toroX);
      expect(a1.n).toBe(6);
      expect(a1.confidence).toBe('baja');

      const carrera: any = await svc.careerBySire();
      const a2 = carrera.sires.find((x: any) => x.sireId === toroX);
      expect(a2.n).toBe(18);
      expect(a2.confidence).toBe('media');
    }, 120_000);

    it('UN AÑO BUENO NO LE MEJORA EL ÍNDICE A NADIE', async () => {
      // Es la razón de combinar ÍNDICES y no kilos: en 2016 todos los terneros pesaron 40 kg más,
      // y el índice del toro no se mueve porque sus contemporáneos subieron con él. Promediar kilos
      // entre años le atribuiría a la genética lo que fue la lluvia.
      const carrera: any = await svc.careerBySire();
      const a = carrera.sires.find((x: any) => x.sireId === toroX);
      const indices = a.by_year.map((y: any) => y.index);
      expect(new Set(indices).size, 'el año bueno movió el índice').toBe(1);
    }, 120_000);

    it('guarda el detalle por temporada, de la más reciente a la más vieja', async () => {
      const carrera: any = await svc.careerBySire();
      const a = carrera.sires.find((x: any) => x.sireId === toroX);
      expect(a.by_year.map((y: any) => y.year)).toEqual([2016, 2015, 2014]);
      expect(a.index).toBeGreaterThan(100); // A es el bueno
    }, 120_000);

    it('la evaluación de UNA temporada NO trae las otras', async () => {
      // El año va en el SQL: antes se leía toda la historia de la finca para descartar el 90%.
      const r: any = await svc.bySire({ year: 2015 });
      expect(r.year).toBe(2015);
      expect(r.group_size).toBe(12); // solo las 12 crías de esa parición
      expect(r.available_years).toEqual(expect.arrayContaining([2014, 2015, 2016]));
    }, 120_000);
  });

  describe('rendimiento en el gancho', () => {
    it('sin reses no inventa nada', async () => {
      const r = await svc.carcassBySire();
      expect(r.total).toBe(0);
      expect(r.sires).toEqual([]);
    });

    it('el rendimiento se DERIVA del último peso vivo, no de la columna guardada', async () => {
      // Se carga `dressing_pct` con un valor ABSURDO a propósito: si el servicio lo leyera de ahí,
      // el test lo delata. Una columna guardada y un cálculo son dos fuentes del mismo número.
      const novillo = (
        await db.query<any>(
          `INSERT INTO animals (tenant_id, farm_id, species_id, sex, status, birth_date, sire_id)
           VALUES ($1,$2,$3,'M','active', CURRENT_DATE - 900, $4) RETURNING id`,
          [db.tenant, farmId, speciesId, toroA],
        )
      )[0].id;
      await db.query(`INSERT INTO weighings (tenant_id, animal_id, weighed_at, weight_kg) VALUES ($1,$2, CURRENT_DATE - 20, 400)`, [db.tenant, novillo]);
      await db.query(
        `INSERT INTO carcass_records (tenant_id, animal_id, slaughter_date, hot_carcass_weight_kg, dressing_pct)
         VALUES ($1,$2, CURRENT_DATE - 10, 220, 99)`,
        [db.tenant, novillo],
      );
      const r = await svc.carcassBySire();
      const a = r.sires.find((x) => x.sireId === toroA)!;
      expect(a.avg_dressing_pct).toBe(55); // 220 / 400, NO el 99 de la columna
    });

    it('una res sin peso vivo se cuenta aparte en vez de rellenarse', async () => {
      // Asumir un peso típico sesgaría al toro cuyos animales se pesaron menos.
      const sinPeso = (
        await db.query<any>(
          `INSERT INTO animals (tenant_id, farm_id, species_id, sex, status, birth_date, sire_id)
           VALUES ($1,$2,$3,'M','active', CURRENT_DATE - 900, $4) RETURNING id`,
          [db.tenant, farmId, speciesId, toroB],
        )
      )[0].id;
      await db.query(`INSERT INTO carcass_records (tenant_id, animal_id, slaughter_date, hot_carcass_weight_kg) VALUES ($1,$2, CURRENT_DATE - 5, 230)`, [db.tenant, sinPeso]);
      const r = await svc.carcassBySire();
      const b = r.sires.find((x) => x.sireId === toroB)!;
      expect(b.without_live_weight).toBe(1);
      expect(b.avg_dressing_pct).toBeNull(); // no hay con qué derivarlo
      expect(b.avg_carcass_kg).toBe(230); // el peso de res sí se conoce
    });

    it('una res más pesada que el animal vivo no rompe la pantalla entera', async () => {
      // Dato imposible. Propagar el error dejaría la evaluación en blanco por UNA fila mal cargada.
      const raro = (
        await db.query<any>(
          `INSERT INTO animals (tenant_id, farm_id, species_id, sex, status, birth_date, sire_id)
           VALUES ($1,$2,$3,'M','active', CURRENT_DATE - 900, $4) RETURNING id`,
          [db.tenant, farmId, speciesId, toroB],
        )
      )[0].id;
      await db.query(`INSERT INTO weighings (tenant_id, animal_id, weighed_at, weight_kg) VALUES ($1,$2, CURRENT_DATE - 20, 300)`, [db.tenant, raro]);
      await db.query(`INSERT INTO carcass_records (tenant_id, animal_id, slaughter_date, hot_carcass_weight_kg) VALUES ($1,$2, CURRENT_DATE - 10, 500)`, [db.tenant, raro]);
      const r = await svc.carcassBySire();
      expect(r.sires.length).toBeGreaterThan(0); // sigue respondiendo
      expect(r.sires.find((x) => x.sireId === toroB)!.without_live_weight).toBe(2);
    });

    it('ordena por rendimiento: lo primero que se quiere ver', async () => {
      const r = await svc.carcassBySire();
      const conRinde = r.sires.filter((s) => s.avg_dressing_pct != null);
      for (let i = 1; i < conRinde.length; i++)
        expect(conRinde[i - 1].avg_dressing_pct!).toBeGreaterThanOrEqual(conRinde[i].avg_dressing_pct!);
    });
  });

  describe('costo de la genética por kilo destetado', () => {
    /** Servicios de un toro sobre la madre, de los cuales `preñan` terminaron en preñez. */
    const servicios = async (sire: string, total: number, prenan: number) => {
      for (let i = 0; i < total; i++) {
        const [{ id }] = await db.query<any>(
          `INSERT INTO breeding_events (tenant_id, animal_id, type, occurred_at, sire_id)
           VALUES ($1,$2,'service_ai', now() - ($3::int || ' days')::interval, $4) RETURNING id`,
          [db.tenant, madre, 200 + i, sire],
        );
        if (i < prenan)
          await db.query(
            `INSERT INTO pregnancies (tenant_id, animal_id, breeding_event_id, diagnosis_date, status)
             VALUES ($1,$2,$3, CURRENT_DATE - 150, 'open')`,
            [db.tenant, madre, id],
          );
      }
    };

    const partida = async (sire: string, precio: number, diasAtras: number) => {
      await db.query(
        `INSERT INTO semen_batches (tenant_id, sire_id, batch_code, acquired_date, unit_cost)
         VALUES ($1,$2,$3, CURRENT_DATE - $4::int, $5)`,
        [db.tenant, sire, `L-${sire.slice(0, 6)}-${diasAtras}`, diasAtras, precio],
      );
    };

    it('sin precio de pajuela informa el desempeño pero NO inventa un costo', async () => {
      // Es la diferencia que importa: un cero se leería «gratis», que acá es la lectura opuesta a
      // la verdad. Falta el dato, y la pantalla tiene que decirlo.
      await servicios(toroA, 4, 4);
      const r = await svc.costBySire();
      const a = r.sires.find((s) => s.sireId === toroA)!;
      expect(a.conception_rate_pct).toBe(100);
      expect(a.straw_cost).toBeNull();
      expect(a.costPerWeanedKg).toBeNull();
    });

    it('EL SEMEN BARATO DE BAJA FERTILIDAD SALE MÁS CARO POR TERNERO', async () => {
      // La razón de existir del cálculo. toroB cuesta menos de la mitad por dosis y preña la mitad
      // de las veces: comparar precios de pajuela lo elegiría, y sería el peor negocio.
      await partida(toroA, 40, 100);
      await partida(toroB, 15, 100);
      await servicios(toroB, 8, 2); // 25% de concepción

      const r = await svc.costBySire();
      const a = r.sires.find((s) => s.sireId === toroA)!;
      const b = r.sires.find((s) => s.sireId === toroB)!;
      expect(b.straw_cost).toBeLessThan(a.straw_cost!);
      expect(b.costPerCalf!).toBeGreaterThan(a.costPerCalf!); // 15/0,25 = 60 contra 40/1 = 40
    });

    it('usa el precio de la partida MÁS RECIENTE, no el histórico', async () => {
      // Comparar contra lo que costaba hace tres años no ayuda a decidir la compra de este año.
      await partida(toroA, 90, 5);
      const r = await svc.costBySire();
      expect(r.sires.find((s) => s.sireId === toroA)!.straw_cost).toBe(90);
    });

    it('UN SERVICIO CON DOS PREÑECES LIGADAS NO CUENTA DOBLE', async () => {
      // El esquema no lo impide: `pregnancies.breeding_event_id` no tiene UNIQUE. Sin `DISTINCT`,
      // ese servicio contaría dos veces como servicio Y como concepción, empujando la fertilidad
      // del toro hacia el 100% — y el número compite con el reporte por toro de Reproducción, así
      // que si difieren ninguno de los dos es creíble.
      const [{ id: solo }] = await db.query<any>(
        `INSERT INTO animals (tenant_id, farm_id, species_id, sex, status) VALUES ($1,$2,$3,'M','active') RETURNING id`,
        [db.tenant, farmId, speciesId],
      );
      const [{ id: evento }] = await db.query<any>(
        `INSERT INTO breeding_events (tenant_id, animal_id, type, occurred_at, sire_id)
         VALUES ($1,$2,'service_ai', now() - interval '300 days', $3) RETURNING id`,
        [db.tenant, madre, solo],
      );
      // Dos preñeces colgando del MISMO servicio.
      for (const _ of [1, 2])
        await db.query(
          `INSERT INTO pregnancies (tenant_id, animal_id, breeding_event_id, diagnosis_date, status)
           VALUES ($1,$2,$3, CURRENT_DATE - 150, 'calved')`,
          [db.tenant, madre, evento],
        );

      // El toro necesita un destete para aparecer en el desempeño: sin eso la aserción sería vacía
      // y el test no protegería nada.
      await cria({ sire: solo, sex: 'M', nacidoHaceDias: 300, destetadoADias: 90, destetaKg: 200, naceKg: 36 });

      const r: any = await svc.costBySire();
      const fila = r.sires.find((x: any) => x.sireId === solo);
      expect(fila, 'el toro tiene que estar en la evaluación para que esto pruebe algo').toBeTruthy();
      expect(fila.services, 'un solo servicio contado dos veces').toBe(1);
    });

    it('la tasa de concepción coincide con la del reporte por toro de Reproducción', async () => {
      // Si acá se contara distinto, dos pantallas mostrarían fertilidades distintas del mismo toro
      // y ninguna sería creíble.
      const r = await svc.costBySire();
      const b = r.sires.find((s) => s.sireId === toroB)!;
      const [fila] = await db.query<any>(
        `SELECT count(*)::int AS services, count(*) FILTER (WHERE p.id IS NOT NULL)::int AS conceptions
           FROM breeding_events be
           LEFT JOIN pregnancies p ON p.breeding_event_id = be.id AND p.status IN ('open','calved') AND p.deleted_at IS NULL
          WHERE be.tenant_id = $1 AND be.sire_id = $2 AND be.deleted_at IS NULL
            AND be.type IN ('service_natural','service_ai')`,
        [db.tenant, toroB],
      );
      expect(b.services).toBe(fila.services);
      expect(b.conceptions).toBe(fila.conceptions);
    });

    it('conserva el desempeño: el costo se agrega, no reemplaza al índice', async () => {
      // Las dos preguntas conviven en la misma fila a propósito — cuál rinde y cuál conviene.
      const desempeno = await svc.bySire();
      const costo = await svc.costBySire();
      expect(costo.group_size).toBe(desempeno.group_size);
      expect(costo.sires.map((s) => s.index)).toEqual(desempeno.sires.map((s) => s.index));
    });
  });
});
