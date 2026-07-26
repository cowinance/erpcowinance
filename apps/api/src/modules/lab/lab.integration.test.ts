import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { LabsService } from './labs.service';
import { SamplesService } from './samples.service';
import { ClinicalCaseService } from '../health/clinical-case.service';

/**
 * Integración de laboratorio (LAB-1/LAB-2): maestro, muestras con la máquina de estados
 * (collected→sent→in_progress→completed/rejected), resultados solo sobre muestras enviadas, y los
 * derivados (is_open, conteos). `db.tenant` cae al demo.
 */
describe('lab — laboratorio', () => {
  let db: DbService;
  let labs: LabsService;
  let samples: SamplesService;
  let originalCwd: string;
  let tmp: string;
  let tenantId: string;
  let labId: string;
  let animalId: string;

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'lab-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    labs = new LabsService(db);
    samples = new SamplesService(db, new ClinicalCaseService(db));
    tenantId = db.tenant;
    animalId = (await db.query<{ id: string }>(`SELECT id FROM animals WHERE tenant_id=$1 LIMIT 1`, [tenantId]))[0].id;
    const lab: any = await labs.create({ name: 'LabVet SA', type: 'pathology', contact: { email: 'lab@vet.com' } });
    labId = lab.id;
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('maestro: crea laboratorio y valida el tipo', async () => {
    expect(labId).toBeTruthy();
    await expect(labs.create({ name: 'X', type: 'invalido' })).rejects.toMatchObject({ status: 400 });
    await expect(labs.create({ name: '' })).rejects.toMatchObject({ status: 400 });
  });

  it('muestra: nace collected, is_open true, tipo validado', async () => {
    const s: any = await samples.create({ sample_type: 'blood', animal_id: animalId, lab_id: labId });
    expect(s.status).toBe('collected');
    expect(s.is_open).toBe(true);
    expect(s.result_count).toBe(0);
    expect(s.animal_tag).toBeDefined();
    await expect(samples.create({ sample_type: 'plasma' })).rejects.toMatchObject({ status: 400 });
  });

  it('animal/potrero/lab inexistente → 404', async () => {
    const nil = '00000000-0000-0000-0000-000000000000';
    await expect(samples.create({ sample_type: 'blood', animal_id: nil })).rejects.toMatchObject({ status: 404 });
    await expect(samples.create({ sample_type: 'soil', paddock_id: nil })).rejects.toMatchObject({ status: 404 });
    await expect(samples.create({ sample_type: 'blood', lab_id: nil })).rejects.toMatchObject({ status: 404 });
  });

  it('máquina de estados: collected→sent→in_progress→completed; transición inválida → 409; idempotente', async () => {
    const s: any = await samples.create({ sample_type: 'milk', lab_id: labId });
    await expect(samples.setStatus(s.id, 'completed')).rejects.toMatchObject({ status: 409 }); // no se puede saltar
    const sent: any = await samples.setStatus(s.id, 'sent');
    expect(sent.status).toBe('sent');
    expect(sent.sent_at).toBeTruthy(); // sella fecha de envío
    expect(await samples.setStatus(s.id, 'sent').then((x: any) => x.status)).toBe('sent'); // idempotente
    await samples.setStatus(s.id, 'in_progress');
    const done: any = await samples.setStatus(s.id, 'completed');
    expect(done.status).toBe('completed');
    expect(done.is_open).toBe(false);
    await expect(samples.setStatus(s.id, 'sent')).rejects.toMatchObject({ status: 409 }); // terminal
  });

  it('resultados: solo sobre muestra enviada; deriva conteos y anormales', async () => {
    const s: any = await samples.create({ sample_type: 'blood', animal_id: animalId, lab_id: labId });
    // 'collected' aún no salió al laboratorio → 409
    await expect(samples.addResult(s.id, { test_code: 'HB' })).rejects.toMatchObject({ status: 409 });
    await samples.setStatus(s.id, 'sent');
    await expect(samples.addResult(s.id, { result_value: '12' })).rejects.toMatchObject({ status: 400 }); // falta test_code
    await samples.addResult(s.id, { test_code: 'HB', result_value: '12', reference_range: '11-15', is_abnormal: false });
    await samples.addResult(s.id, { test_code: 'GLU', result_value: '180', reference_range: '60-110', is_abnormal: true });
    const results: any[] = await samples.listResults(s.id);
    expect(results).toHaveLength(2);
    const reread: any = await samples.get(s.id);
    expect(reread.result_count).toBe(2);
    expect(reread.abnormal_count).toBe(1);
  });

  it('baja lógica de la muestra', async () => {
    const s: any = await samples.create({ sample_type: 'hair' });
    await samples.remove(s.id);
    await expect(samples.get(s.id)).rejects.toMatchObject({ status: 404 });
  });

  /**
   * El lazo con Sanidad (Fase 3.1). Lo que se fija acá no es que el caso aparezca, sino que aparezca
   * SOLO cuando corresponde: el modo de falla caro no es que falte un caso, es que Sanidad se llene
   * de casos que nadie cierra hasta que la pantalla se vuelve ruido.
   */
  describe('resultado positivo → caso clínico', () => {
    let brucelosis: string;
    let mastitis: string;

    /** Muestra de sangre lista para recibir resultados. */
    const enviada = async (animal: string | null = animalId) => {
      const s: any = await samples.create({ sample_type: 'blood', animal_id: animal, lab_id: labId });
      await samples.setStatus(s.id, 'sent');
      return s.id as string;
    };

    beforeAll(async () => {
      // Del catálogo global: brucelosis es de denuncia obligatoria, mastitis no.
      brucelosis = (await db.query<any>(`SELECT id FROM diagnoses WHERE code='brucelosis' AND tenant_id IS NULL`))[0].id;
      mastitis = (await db.query<any>(`SELECT id FROM diagnoses WHERE code='mastitis' AND tenant_id IS NULL`))[0].id;
    });

    it('un diagnóstico positivo abre el caso con el animal ya cargado', async () => {
      const sid = await enviada();
      const r: any = await samples.addResult(sid, { test_code: 'MAST-CMT', result_value: 'positivo', is_abnormal: true, diagnosis_id: mastitis });
      expect(r.case_assessment.opensCase).toBe(true);
      expect(r.clinical_case_id).toBeTruthy();
      const cc: any = await db.query(`SELECT animal_id, diagnosis_id, severity, status FROM clinical_cases WHERE id=$1`, [r.clinical_case_id]).then((x: any) => x[0]);
      expect(cc.animal_id).toBe(animalId);
      expect(cc.diagnosis_id).toBe(mastitis);
      expect(cc.severity).toBe('moderate');
    });

    it('la enfermedad de denuncia obligatoria abre el caso SEVERO', async () => {
      const sid = await enviada();
      const r: any = await samples.addResult(sid, { test_code: 'BRUC-RB', result_value: 'positivo', is_abnormal: true, diagnosis_id: brucelosis });
      const cc: any = await db.query(`SELECT severity FROM clinical_cases WHERE id=$1`, [r.clinical_case_id]).then((x: any) => x[0]);
      expect(cc.severity).toBe('severe');
    });

    it('UN SEGUNDO RESULTADO NO ABRE UN CASO NUEVO: se suma al que ya está abierto', async () => {
      // La tanda de análisis de un mismo animal es lo normal, no la excepción. Sin esto, cinco
      // resultados dan cinco casos por lo mismo y la pantalla de Sanidad deja de servir.
      const antes: any = await db.query(`SELECT count(*)::int AS n FROM clinical_cases WHERE tenant_id=$1 AND animal_id=$2 AND diagnosis_id=$3`, [tenantId, animalId, brucelosis]);
      const sid = await enviada();
      const r: any = await samples.addResult(sid, { test_code: 'BRUC-ELISA', result_value: 'positivo', is_abnormal: true, diagnosis_id: brucelosis });
      const despues: any = await db.query(`SELECT count(*)::int AS n FROM clinical_cases WHERE tenant_id=$1 AND animal_id=$2 AND diagnosis_id=$3`, [tenantId, animalId, brucelosis]);
      expect(despues[0].n).toBe(antes[0].n);
      // Y el resultado nuevo queda apuntando al caso vivo, no huérfano.
      expect(r.clinical_case_id).toBeTruthy();
      const seguimientos: any = await db.query(`SELECT count(*)::int AS n FROM clinical_case_events WHERE case_id=$1 AND kind='note'`, [r.clinical_case_id]);
      expect(seguimientos[0].n).toBeGreaterThan(0);
    });

    it('FUERA DE RANGO SIN DIAGNÓSTICO NO ABRE CASO, y dice por qué', async () => {
      const sid = await enviada();
      const r: any = await samples.addResult(sid, { test_code: 'GLU', result_value: '180', is_abnormal: true });
      expect(r.clinical_case_id).toBeNull();
      expect(r.case_assessment.reason).toBe('needs_judgement');
    });

    it('una muestra sin animal no abre caso, aunque el diagnóstico sea grave', async () => {
      const sid = await enviada(null);
      const r: any = await samples.addResult(sid, { test_code: 'BRUC-RB', result_value: 'positivo', is_abnormal: true, diagnosis_id: brucelosis });
      expect(r.clinical_case_id).toBeNull();
      expect(r.case_assessment.reason).toBe('no_animal');
    });

    it('el veterinario abre el caso a mano desde un resultado sin diagnóstico', async () => {
      const sid = await enviada();
      const r: any = await samples.addResult(sid, { test_code: 'SCC', result_value: '900000', is_abnormal: true });
      expect(r.clinical_case_id).toBeNull();
      const abierto: any = await samples.openCaseFromResult(r.id, { diagnosis_id: mastitis });
      expect(abierto.clinical_case_id).toBeTruthy();
      // El diagnóstico que puso el veterinario queda EN el resultado: la próxima vez ya no hace
      // falta criterio para lo mismo.
      const [rr]: any = await samples.listResults(sid);
      expect(rr.diagnosis_id).toBe(mastitis);
    });

    it('reabrir desde el mismo resultado es idempotente', async () => {
      // La alerta que quedó abierta en otra pestaña no puede duplicar el caso.
      const sid = await enviada();
      const r: any = await samples.addResult(sid, { test_code: 'MAST-CMT', is_abnormal: true, diagnosis_id: mastitis });
      const otra: any = await samples.openCaseFromResult(r.id, {});
      expect(otra.already_linked).toBe(true);
      expect(otra.clinical_case_id).toBe(r.clinical_case_id);
    });

    it('sin diagnóstico ni en el resultado ni en el pedido, no adivina', async () => {
      const sid = await enviada();
      const r: any = await samples.addResult(sid, { test_code: 'GLU', is_abnormal: true });
      await expect(samples.openCaseFromResult(r.id, {})).rejects.toMatchObject({ status: 400 });
    });

    it('un diagnóstico inexistente se rechaza en vez de guardarse en null', async () => {
      const sid = await enviada();
      await expect(
        samples.addResult(sid, { test_code: 'X', is_abnormal: true, diagnosis_id: '00000000-0000-4000-8000-000000000000' }),
      ).rejects.toMatchObject({ status: 400 });
    });
  });
});
