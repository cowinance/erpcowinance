import { Injectable } from '@nestjs/common';
import { adjustWeaningWeight, computeDressingPct, computeGeneticCost, confidenceFor, sireIndexes, type AnimalSex, type ContemporaryMember } from '@cowinance/domain';
import { DbService } from '../../db/db.service';

/**
 * Evaluación de toros: de la pajuela al kilo (Fase 2.3).
 *
 * Hasta acá Genética era un DEPÓSITO — sabía qué pajuela había, en qué termo y cuánto nitrógeno
 * quedaba, pero nunca se unía con el desempeño de los animales. Contestaba «¿qué tengo?» y no la
 * pregunta que cuesta plata: **¿qué semen vuelvo a comprar?**
 *
 * La cadena ya existía entera en el esquema y nadie la recorría:
 *
 *   semen_batches → breeding_events → pregnancies → calvings → calving_offspring
 *                 → animals (sire_id) → weanings → v_weighings
 *
 * Se entra por `animals.sire_id`, que es el padre EFECTIVO del ternero, y no por el evento
 * reproductivo. Motivo: un servicio puede no haber preñado, una preñez puede perderse, y lo que
 * hay que evaluar es el ternero que efectivamente nació. Ir por el evento contaría intenciones.
 */
@Injectable()
export class SireEvaluationService {
  constructor(private readonly db: DbService) {}

  /**
   * Evaluación por toro dentro de un grupo contemporáneo.
   *
   * El grupo por defecto es el AÑO DE NACIMIENTO: los terneros de una misma parición comparten
   * clima, pasto y manejo. Comparar contra otro año le atribuiría a la genética lo que fue la
   * lluvia. Es la agrupación más gruesa que sigue siendo honesta; afinarla por lote es el paso
   * siguiente cuando haya volumen para sostenerlo.
   */
  async bySire(params: { year?: number } = {}) {
    const t = this.db.tenant;

    const crias = await this.db.query<any>(
      `SELECT a.id, a.sex, a.birth_date,
              a.sire_id,
              COALESCE(sa.name, si.value, 'Sin identificar') AS sire_name,
              w.weaning_weight_kg::float AS weaning_kg,
              w.weaning_date,
              (w.weaning_date::date - a.birth_date::date)::int AS edad_destete_dias,
              co.birth_weight_kg::float AS birth_kg,
              -- Edad de la madre AL PARIR, no hoy: el ajuste corrige la leche que dio entonces.
              CASE WHEN dam.birth_date IS NOT NULL
                   THEN EXTRACT(YEAR FROM age(a.birth_date::date, dam.birth_date::date))::int END AS dam_age_years,
              EXTRACT(YEAR FROM a.birth_date::date)::int AS anio
         FROM animals a
         JOIN weanings w ON w.animal_id = a.id AND w.deleted_at IS NULL AND w.weaning_weight_kg IS NOT NULL
         LEFT JOIN animals sa ON sa.id = a.sire_id AND sa.deleted_at IS NULL
         LEFT JOIN LATERAL (
           SELECT value FROM animal_identifiers x
            WHERE x.animal_id = a.sire_id AND x.type = 'visual' AND x.deleted_at IS NULL
            ORDER BY x.created_at DESC LIMIT 1) si ON true
         LEFT JOIN animals dam ON dam.id = a.dam_id AND dam.deleted_at IS NULL
         LEFT JOIN LATERAL (
           SELECT birth_weight_kg FROM calving_offspring c
            WHERE c.animal_id = a.id AND c.deleted_at IS NULL LIMIT 1) co ON true
        WHERE a.tenant_id = $1 AND a.deleted_at IS NULL AND a.sire_id IS NOT NULL
          AND a.birth_date IS NOT NULL AND w.weaning_date IS NOT NULL`,
      [t],
    );

    // Un destete con edad no positiva es un dato mal cargado (fecha anterior al nacimiento). Se
    // descarta y se CUENTA, en vez de dejarlo romper el promedio en silencio.
    const utilizables = crias.filter((c) => Number(c.edad_destete_dias) > 0 && Number(c.weaning_kg) > 0);
    const descartadas = crias.length - utilizables.length;

    const anios = [...new Set(utilizables.map((c) => c.anio))].sort((a, b) => b - a);
    const anio = params.year ?? anios[0];
    const grupo = utilizables.filter((c) => c.anio === anio);

    const nombres = new Map<string, string>();
    let incompletas = 0;
    const miembros: ContemporaryMember[] = [];
    for (const c of grupo) {
      const aj = adjustWeaningWeight({
        weaningWeightKg: Number(c.weaning_kg),
        birthWeightKg: c.birth_kg ?? null,
        ageAtWeaningDays: Number(c.edad_destete_dias),
        sex: c.sex as AnimalSex,
        damAgeYears: c.dam_age_years ?? null,
      });
      if (!aj.complete) incompletas++;
      nombres.set(c.sire_id, c.sire_name);
      miembros.push({ sireId: c.sire_id, adjustedKg: aj.adjustedKg });
    }

    return {
      // El año evaluado y los disponibles: sin esto, el usuario no sabe QUÉ está mirando.
      year: anio ?? null,
      available_years: anios,
      group_size: grupo.length,
      /** Terneros a los que les faltó peso de nacimiento o edad de madre: el índice los incluye pero son menos comparables. */
      incomplete: incompletas,
      /** Destetes con datos imposibles, descartados. Se informa en vez de esconderse. */
      discarded: descartadas,
      sires: sireIndexes(miembros).map((s) => ({ ...s, sire_name: nombres.get(s.sireId) ?? 'Sin identificar' })),
    };
  }

  /**
   * Costo de la genética por kilo destetado (Fase 2.5).
   *
   * Cierra el módulo: la evaluación por desempeño contesta **cuál rinde más**, ésta contesta **cuál
   * conviene**. No es lo mismo — un toro 8% mejor al destete que cuesta el triple por dosis puede
   * ser el peor negocio de la finca.
   *
   * La tasa de concepción usa la MISMA definición que el reporte por toro de Reproducción
   * (`repro-reports.byBull`): una preñez `open` o `calved` ligada al evento de servicio. Si acá se
   * contara distinto, dos pantallas del sistema mostrarían fertilidades distintas para el mismo
   * toro y ninguna sería creíble. Lo único que cambia es la ventana: aquel reporte mira un período
   * y éste mira TODA la historia del toro, porque volver a comprar esa genética es una decisión
   * sobre el toro, no sobre una temporada.
   *
   * El precio es el de la partida MÁS RECIENTE de ese toro: comparar contra lo que costaba hace
   * tres años no ayuda a decidir la compra de este año.
   */
  async costBySire(params: { year?: number } = {}) {
    const t = this.db.tenant;
    const desempeno = await this.bySire(params);

    const economia = await this.db.query<any>(
      `SELECT be.sire_id,
              count(*)::int AS servicios,
              count(*) FILTER (WHERE p.id IS NOT NULL)::int AS concepciones,
              (SELECT sb.unit_cost::float FROM semen_batches sb
                WHERE sb.sire_id = be.sire_id AND sb.tenant_id = be.tenant_id AND sb.deleted_at IS NULL
                  AND sb.unit_cost IS NOT NULL
                ORDER BY sb.acquired_date DESC NULLS LAST LIMIT 1) AS precio_pajuela
         FROM breeding_events be
         LEFT JOIN pregnancies p ON p.breeding_event_id = be.id AND p.status IN ('open','calved') AND p.deleted_at IS NULL
        WHERE be.tenant_id = $1 AND be.deleted_at IS NULL AND be.sire_id IS NOT NULL
          AND be.type IN ('service_natural','service_ai')
        GROUP BY be.sire_id, be.tenant_id`,
      [t],
    );
    const porToro = new Map(economia.map((e) => [e.sire_id, e]));

    return {
      ...desempeno,
      sires: desempeno.sires.map((s) => {
        const e = porToro.get(s.sireId);
        const tasa = e && e.servicios > 0 ? (e.concepciones / e.servicios) * 100 : null;
        const costo = computeGeneticCost({
          // Sin partida con precio no hay costo que calcular; NaN es el «no sé» que la regla
          // convierte en null. Un cero diría «gratis», que acá se leería al revés de la verdad.
          strawCost: e?.precio_pajuela ?? Number.NaN,
          conceptionRatePct: tasa,
          avgWeaningKg: s.meanKg,
        });
        return {
          ...s,
          services: e?.servicios ?? 0,
          conceptions: e?.concepciones ?? 0,
          conception_rate_pct: tasa == null ? null : Math.round(tasa * 10) / 10,
          straw_cost: e?.precio_pajuela ?? null,
          ...costo,
        };
      }),
    };
  }

  /**
   * Rendimiento en el gancho por toro (Fase 2.4) — el último escalón de la cadena.
   *
   * El destete dice cuánto creció el ternero; la res dice cuánto de eso se cobra. Un toro puede dar
   * terneros pesados que rinden mal, y ahí el índice de destete solo cuenta media historia.
   *
   * El rendimiento se DERIVA (`computeDressingPct`: res ÷ último peso vivo) y no se lee de la
   * columna `dressing_pct`, aunque exista: una columna guardada y un cálculo son dos fuentes del
   * mismo número, y el día que difieran nadie sabrá cuál creer. Es la misma regla que usa el módulo
   * de Faena, así que los dos muestran lo mismo por construcción.
   *
   * Sin peso vivo registrado no hay rendimiento posible: esas reses se cuentan aparte en vez de
   * asumir un peso típico, que sesgaría al toro cuyos animales se pesaron menos.
   */
  async carcassBySire() {
    const t = this.db.tenant;
    const reses = await this.db.query<any>(
      `SELECT cr.id, cr.hot_carcass_weight_kg::float AS res_kg, cr.slaughter_date,
              a.sire_id, COALESCE(sa.name, si.value, 'Sin identificar') AS sire_name,
              w.weight_kg::float AS vivo_kg
         FROM carcass_records cr
         JOIN animals a ON a.id = cr.animal_id AND a.deleted_at IS NULL AND a.sire_id IS NOT NULL
         LEFT JOIN animals sa ON sa.id = a.sire_id AND sa.deleted_at IS NULL
         LEFT JOIN LATERAL (
           SELECT value FROM animal_identifiers x
            WHERE x.animal_id = a.sire_id AND x.type = 'visual' AND x.deleted_at IS NULL
            ORDER BY x.created_at DESC LIMIT 1) si ON true
         -- Último peso vivo ANTES de la faena: pesar después no existe, y tomar el más reciente sin
         -- esa condición podría agarrar una carga posterior mal fechada.
         LEFT JOIN LATERAL (
           SELECT weight_kg FROM weighings ww
            WHERE ww.animal_id = a.id AND ww.deleted_at IS NULL AND ww.weighed_at::date <= cr.slaughter_date
            ORDER BY ww.weighed_at DESC LIMIT 1) w ON true
        WHERE cr.tenant_id = $1 AND cr.deleted_at IS NULL AND cr.hot_carcass_weight_kg IS NOT NULL`,
      [t],
    );

    interface AcumToro {
      nombre: string;
      rindes: number[];
      resKg: number[];
      sinPesoVivo: number;
    }
    const porToro = new Map<string, AcumToro>();
    for (const r of reses) {
      const acc: AcumToro = porToro.get(r.sire_id) ?? { nombre: r.sire_name, rindes: [], resKg: [], sinPesoVivo: 0 };
      acc.resKg.push(Number(r.res_kg));
      let rinde: number | null = null;
      try {
        rinde = computeDressingPct(Number(r.res_kg), r.vivo_kg ?? null);
      } catch {
        // Res más pesada que el animal vivo: dato imposible. Se descarta como «sin rendimiento» en
        // vez de propagar el error y dejar la pantalla entera en blanco por una fila mal cargada.
        rinde = null;
      }
      if (rinde == null) acc.sinPesoVivo++;
      else acc.rindes.push(rinde);
      porToro.set(r.sire_id, acc);
    }

    const media = (xs: number[]) => (xs.length ? Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 100) / 100 : null);

    return {
      total: reses.length,
      sires: [...porToro.entries()]
        .map(([sireId, v]) => ({
          sireId,
          sire_name: v.nombre,
          n: v.resKg.length,
          avg_carcass_kg: media(v.resKg),
          avg_dressing_pct: media(v.rindes),
          /** Reses sin peso vivo con el que derivar el rendimiento. Se informan, no se rellenan. */
          without_live_weight: v.sinPesoVivo,
          confidence: confidenceFor(v.rindes.length),
        }))
        .sort((a, b) => (b.avg_dressing_pct ?? 0) - (a.avg_dressing_pct ?? 0)),
    };
  }
}
