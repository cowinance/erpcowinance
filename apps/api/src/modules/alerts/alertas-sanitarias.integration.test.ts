import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { WeatherService } from '../weather/weather.service';
import { AlertsService } from './alerts.service';
import { NitrogenService } from '../genetics/nitrogen.service';
import { InventoryService } from '../inventory/inventory.service';

/**
 * Fase 1.2 — laboratorio y calidad de leche, los dos datos que morían donde se cargaban.
 *
 * El caso de laboratorio tiene la decisión de diseño más delicada del motor: **un resultado anormal
 * es un HECHO y no deja de serlo nunca**. Si la alerta dependiera solo de eso, no se apagaría jamás
 * y el reconciliador dejaría de reconciliar. Se apaga cuando alguien ACTUÓ —abrió un caso clínico
 * después del resultado— y caduca sola pasada la ventana. Los dos caminos se prueban acá.
 */
describe('alertas sanitarias — laboratorio y calidad de leche', () => {
  let db: DbService;
  let svc: AlertsService;
  let originalCwd: string;
  let tmp: string;
  let farmId: string;
  let speciesId: string;

  const abiertas = async (code: string, relatedId?: string) => {
    const extra = relatedId ? ` AND a.related_id='${relatedId}'` : '';
    return (
      await db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM alerts a JOIN alert_rules r ON r.id=a.rule_id
          WHERE a.tenant_id=$1 AND r.condition->>'code'=$2 AND a.status='open' AND a.deleted_at IS NULL${extra}`,
        [db.tenant, code],
      )
    )[0].n;
  };

  const nuevoAnimal = async () =>
    (
      await db.query<{ id: string }>(
        `INSERT INTO animals (tenant_id, farm_id, species_id, sex, status) VALUES ($1,$2,$3,'F','active') RETURNING id`,
        [db.tenant, farmId, speciesId],
      )
    )[0].id;

  /** Muestra + resultado anormal, reportado hace `diasAtras` días. */
  const resultadoAnormal = async (animalId: string, diasAtras: number, code = 'BRUC') => {
    const labId = (
      await db.query<{ id: string }>(`INSERT INTO labs (tenant_id, name) VALUES ($1,'Lab Regional') RETURNING id`, [db.tenant])
    )[0].id;
    const sample = (
      await db.query<{ id: string }>(
        `INSERT INTO lab_samples (tenant_id, lab_id, sample_type, animal_id, collected_at, status)
         VALUES ($1,$2,'blood',$3, now() - ($4::int * interval '1 day'),'completed') RETURNING id`,
        [db.tenant, labId, animalId, diasAtras],
      )
    )[0].id;
    return (
      await db.query<{ id: string }>(
        `INSERT INTO lab_results (tenant_id, sample_id, test_code, result_value, reference_range, is_abnormal, reported_at)
         VALUES ($1,$2,$3,'positivo','negativo',true, now() - ($4::int * interval '1 day')) RETURNING id`,
        [db.tenant, sample, code, diasAtras],
      )
    )[0].id;
  };

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'alertas-san-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    svc = new AlertsService(db, { statusAlerts: async () => [] } as any, new WeatherService(db), new NitrogenService(db, new InventoryService(db)));
    farmId = (await db.query<{ id: string }>(`SELECT id FROM farms WHERE tenant_id=$1 LIMIT 1`, [db.tenant]))[0].id;
    speciesId = (await db.query<{ id: string }>(`SELECT id FROM species LIMIT 1`))[0].id;
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  describe('resultado de laboratorio fuera de rango', () => {
    let animalId: string;

    beforeAll(async () => {
      animalId = await nuevoAnimal();
      await resultadoAnormal(animalId, 2);
    });

    it('avisa, con el valor y el rango de referencia', async () => {
      await svc.evaluate();
      expect(await abiertas('lab_result_abnormal', animalId)).toBe(1);
      const [a] = await db.query<any>(`SELECT title, message FROM alerts WHERE tenant_id=$1 AND related_id=$2 AND status='open'`, [db.tenant, animalId]);
      expect(a.title).toContain('BRUC');
      expect(a.message).toContain('referencia negativo');
    });

    it('un resultado NORMAL no alerta: lo anormal lo decide el laboratorio', async () => {
      const sano = await nuevoAnimal();
      const labId = (await db.query<{ id: string }>(`INSERT INTO labs (tenant_id, name) VALUES ($1,'Lab 2') RETURNING id`, [db.tenant]))[0].id;
      const sample = (
        await db.query<{ id: string }>(
          `INSERT INTO lab_samples (tenant_id, lab_id, sample_type, animal_id, collected_at, status) VALUES ($1,$2,'blood',$3, now(),'completed') RETURNING id`,
          [db.tenant, labId, sano],
        )
      )[0].id;
      await db.query(
        `INSERT INTO lab_results (tenant_id, sample_id, test_code, result_value, is_abnormal, reported_at) VALUES ($1,$2,'BRUC','negativo',false, now())`,
        [db.tenant, sample],
      );
      await svc.evaluate();
      expect(await abiertas('lab_result_abnormal', sano)).toBe(0);
    });

    it('ABRIR UN CASO CLÍNICO la apaga: la alerta pedía una acción y la acción ocurrió', async () => {
      await db.query(
        `INSERT INTO clinical_cases (tenant_id, animal_id, status, started_at) VALUES ($1,$2,'open', now())`,
        [db.tenant, animalId],
      );
      await svc.evaluate();
      expect(await abiertas('lab_result_abnormal', animalId)).toBe(0);
    });

    it('un caso ANTERIOR al resultado no la apaga', async () => {
      // Si el caso venía de antes, no es la respuesta a este resultado: el aviso sigue siendo válido.
      const otro = await nuevoAnimal();
      await db.query(`INSERT INTO clinical_cases (tenant_id, animal_id, status, started_at) VALUES ($1,$2,'open', now() - interval '10 days')`, [db.tenant, otro]);
      await resultadoAnormal(otro, 1, 'TUBER');
      await svc.evaluate();
      expect(await abiertas('lab_result_abnormal', otro)).toBe(1);
    });

    it('pasada la ventana caduca sola: ya es historia clínica, no una tarea', async () => {
      const viejo = await nuevoAnimal();
      await resultadoAnormal(viejo, 400, 'LEUCO'); // muy fuera de los 30 días por defecto
      await svc.evaluate();
      expect(await abiertas('lab_result_abnormal', viejo)).toBe(0);
    });

    it('una muestra SIN animal (suelo, agua) no genera alerta sanitaria del hato', async () => {
      const labId = (await db.query<{ id: string }>(`INSERT INTO labs (tenant_id, name) VALUES ($1,'Lab 3') RETURNING id`, [db.tenant]))[0].id;
      const sample = (
        await db.query<{ id: string }>(
          `INSERT INTO lab_samples (tenant_id, lab_id, sample_type, collected_at, status) VALUES ($1,$2,'soil', now(),'completed') RETURNING id`,
          [db.tenant, labId],
        )
      )[0].id;
      await db.query(
        `INSERT INTO lab_results (tenant_id, sample_id, test_code, result_value, is_abnormal, reported_at) VALUES ($1,$2,'COLI','alto',true, now())`,
        [db.tenant, sample],
      );
      const antes = await abiertas('lab_result_abnormal');
      await svc.evaluate();
      expect(await abiertas('lab_result_abnormal')).toBe(antes);
    });
  });

  describe('recuento celular alto', () => {
    let vaca: string;
    let tanque: string;

    beforeAll(async () => {
      vaca = await nuevoAnimal();
      tanque = (
        await db.query<{ id: string }>(`INSERT INTO milk_tanks (tenant_id, farm_id, name) VALUES ($1,$2,'Tanque 1') RETURNING id`, [db.tenant, farmId])
      )[0].id;
    });

    it('una vaca por encima del umbral avisa (warning)', async () => {
      await db.query(`INSERT INTO milk_quality_tests (tenant_id, animal_id, sample_date, scc) VALUES ($1,$2, CURRENT_DATE - 1, 450000)`, [db.tenant, vaca]);
      await svc.evaluate();
      expect(await abiertas('milk_scc_high', vaca)).toBe(1);
      const [a] = await db.query<any>(`SELECT severity FROM alerts WHERE tenant_id=$1 AND related_id=$2 AND status='open'`, [db.tenant, vaca]);
      expect(a.severity).toBe('warning');
    });

    it('el TANQUE es crítico: compromete la entrega entera, no una vaca', async () => {
      await db.query(`INSERT INTO milk_quality_tests (tenant_id, tank_id, sample_date, scc) VALUES ($1,$2, CURRENT_DATE, 520000)`, [db.tenant, tanque]);
      await svc.evaluate();
      const [a] = await db.query<any>(`SELECT severity, title FROM alerts WHERE tenant_id=$1 AND related_id=$2 AND status='open'`, [db.tenant, tanque]);
      expect(a.severity).toBe('critical');
      expect(a.title).toContain('Tanque 1');
    });

    it('un análisis NUEVO y bueno la apaga sola — solo cuenta el último', async () => {
      await db.query(`INSERT INTO milk_quality_tests (tenant_id, animal_id, sample_date, scc) VALUES ($1,$2, CURRENT_DATE, 120000)`, [db.tenant, vaca]);
      await svc.evaluate();
      expect(await abiertas('milk_scc_high', vaca)).toBe(0);
    });

    it('un valor alto VIEJO ya normalizado no molesta más', async () => {
      // El de arriba dejó un 450.000 de ayer y un 120.000 de hoy: gana el último.
      const [ult] = await db.query<any>(
        `SELECT scc FROM milk_quality_tests WHERE tenant_id=$1 AND animal_id=$2 ORDER BY sample_date DESC LIMIT 1`,
        [db.tenant, vaca],
      );
      expect(Number(ult.scc)).toBe(120000);
      expect(await abiertas('milk_scc_high', vaca)).toBe(0);
    });

    it('el umbral es configurable: bajarlo hace entrar lo que antes no entraba', async () => {
      // La unidad del recuento no está documentada en el modelo, así que el umbral tiene que poder
      // ajustarse: una finca que carga miles necesita 200, no 200.000.
      await db.query(`UPDATE alert_rules SET condition = jsonb_build_object('code','milk_scc_high','days',100000) WHERE tenant_id=$1 AND condition->>'code'='milk_scc_high'`, [db.tenant]);
      await svc.evaluate();
      expect(await abiertas('milk_scc_high', vaca)).toBe(1); // 120.000 ahora sí supera
      await db.query(`UPDATE alert_rules SET condition = jsonb_build_object('code','milk_scc_high','days',200000) WHERE tenant_id=$1 AND condition->>'code'='milk_scc_high'`, [db.tenant]);
    });
  });
});
