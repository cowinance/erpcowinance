import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { BreedingService } from './breeding.service';

/**
 * Integración de cría y recría (C3): verifica que el servicio compone bien reproducción/destete/
 * estructura/superficie del demo y deriva las tasas con la regla de dominio. Se usa un período amplio
 * (2000–2100) para capturar todo el seed sin depender de la fecha de hoy, y se cruza cada agregado con
 * una consulta independiente (evita números mágicos frágiles y prueba la composición SQL real).
 */
describe('breeding — cría y recría', () => {
  let db: DbService;
  let svc: BreedingService;
  let originalCwd: string;
  let tmp: string;
  const FROM = '2000-01-01';
  const TO = '2100-01-01';

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'breeding-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    svc = new BreedingService(db);
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('cuadra los conteos con consultas independientes y deriva las tasas', async () => {
    const t = db.tenant;
    const res: any = await svc.summary(FROM, TO);

    const [serviced] = await db.query<{ n: number }>(
      `SELECT count(DISTINCT animal_id)::int AS n FROM breeding_events
       WHERE tenant_id=$1 AND deleted_at IS NULL AND type IN ('service_natural','service_ai','embryo_transfer') AND occurred_at::date BETWEEN $2::date AND $3::date`,
      [t, FROM, TO],
    );
    const [weanings] = await db.query<{ n: number; kg: number }>(
      `SELECT count(*)::int AS n, COALESCE(sum(weaning_weight_kg),0)::float AS kg FROM weanings WHERE tenant_id=$1 AND deleted_at IS NULL AND weaning_date BETWEEN $2::date AND $3::date`,
      [t, FROM, TO],
    );
    const [cows] = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM animals a JOIN animal_categories c ON c.id=a.category_id WHERE a.tenant_id=$1 AND a.status='active' AND a.deleted_at IS NULL AND c.code='vaca'`, [t]);
    const [heifers] = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM animals a JOIN animal_categories c ON c.id=a.category_id WHERE a.tenant_id=$1 AND a.status='active' AND a.deleted_at IS NULL AND c.code='vaquillona'`, [t]);
    const [ha] = await db.query<{ n: number }>(`SELECT COALESCE(sum(area_ha),0)::float AS n FROM paddocks WHERE tenant_id=$1 AND deleted_at IS NULL`, [t]);

    // Los conteos del servicio cuadran con las consultas directas.
    expect(res.counts.serviced_females).toBe(serviced.n);
    expect(res.counts.weanings).toBe(weanings.n);
    expect(res.counts.breeding_cows).toBe(cows.n);
    expect(res.counts.replacement_heifers).toBe(heifers.n);
    expect(res.counts.total_ha).toBeCloseTo(ha.n, 3);

    // El demo tiene rodeo de cría: hay vacas, vaquillonas y superficie.
    expect(cows.n).toBeGreaterThan(0);
    expect(heifers.n).toBeGreaterThan(0);
    expect(ha.n).toBeGreaterThan(0);

    // Las tasas derivadas respetan la fórmula (regla única).
    expect(res.replacement_rate).toBe(Math.round((heifers.n / cows.n) * 1000) / 10);
    if (serviced.n > 0) {
      expect(res.weaning_rate).toBe(Math.round((weanings.n / serviced.n) * 1000) / 1000);
    }
    expect(res.kg_weaned_per_ha).toBe(Math.round((weanings.kg / ha.n) * 10) / 10);
  });

  it('período sin datos → tasas dependientes de período en null, estructura intacta', async () => {
    const res: any = await svc.summary('1990-01-01', '1990-12-31');
    expect(res.counts.serviced_females).toBe(0);
    expect(res.weaning_rate).toBeNull(); // sin entoradas
    expect(res.pregnancy_rate).toBeNull();
    // Reposición es estructural (rodeo actual), no depende del período.
    expect(res.replacement_rate).toBeGreaterThan(0);
  });
});
