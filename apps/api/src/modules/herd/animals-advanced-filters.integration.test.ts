import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { BillingService } from '../billing/billing.service';
import { HerdService } from './herd.service';
import type { AnimalWriteService } from './animal-write.service';

/**
 * Animales E1 — filtros avanzados (presencia/ausencia, sanidad, repro, sin-pesaje),
 * búsqueda por cualquier identificador y orden configurable con keyset. Datos
 * controlados para asserts exactos. Reusa las tablas reales (treatments, clinical_cases,
 * pregnancies, animal_identifiers) — no reimplementa reglas, solo filtra.
 */
describe('HerdService.listAnimals — filtros avanzados + orden (E1)', () => {
  let db: DbService;
  let herd: HerdService;
  let originalCwd: string;
  let tmp: string;
  let lot: string;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'advfilters-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    herd = new HerdService(db, {} as AnimalWriteService, new BillingService(db));
    const farmId = (await db.query<{ id: string }>(`SELECT id FROM farms WHERE tenant_id=$1 LIMIT 1`, [db.tenant]))[0].id;
    const speciesId = (await db.query<{ id: string }>(`SELECT id FROM species LIMIT 1`))[0].id;
    lot = ((await herd.createLot({ name: 'Adv L' })) as any).id;

    const mk = async (key: string, opts: { sex?: string; kg?: number; origin?: string; withLot?: boolean }) => {
      const id = (
        await db.query<{ id: string }>(
          `INSERT INTO animals (tenant_id, farm_id, species_id, sex, status, current_lot_id, origin)
           VALUES ($1,$2,$3,$4,'active',$5,$6) RETURNING id`,
          [db.tenant, farmId, speciesId, opts.sex ?? 'F', opts.withLot === false ? null : lot, opts.origin ?? 'born'],
        )
      )[0].id;
      if (opts.kg)
        await db.query(`INSERT INTO weighings (tenant_id, animal_id, weighed_at, weight_kg) VALUES ($1,$2,now(),$3)`, [
          db.tenant,
          id,
          opts.kg,
        ]);
      ids[key] = id;
      return id;
    };

    await mk('withdrawal', { kg: 400 });
    await mk('case', { kg: 500 });
    await mk('pregnant', { kg: 600 });
    await mk('nolot', { withLot: false });
    await mk('purchased', { origin: 'purchased', kg: 450 });
    await mk('noweight', {}); // en el lote, nunca pesado

    // Identificadores: visual para todos + un RFID buscable + un oficial.
    await db.query(`INSERT INTO animal_identifiers (tenant_id, animal_id, type, value) VALUES ($1,$2,'visual','V-100')`, [db.tenant, ids.withdrawal]);
    await db.query(`INSERT INTO animal_identifiers (tenant_id, animal_id, type, value) VALUES ($1,$2,'rfid','RF-XYZ-999')`, [db.tenant, ids.case]);
    await db.query(`INSERT INTO animal_identifiers (tenant_id, animal_id, type, value, is_official) VALUES ($1,$2,'official','AR-0001',true)`, [db.tenant, ids.pregnant]);

    // Sanidad: retiro activo + caso clínico abierto.
    await db.query(
      `INSERT INTO treatments (tenant_id, animal_id, applied_at, meat_withdrawal_until) VALUES ($1,$2,now(), CURRENT_DATE + 10)`,
      [db.tenant, ids.withdrawal],
    );
    await db.query(
      `INSERT INTO clinical_cases (tenant_id, animal_id, status, started_at) VALUES ($1,$2,'in_treatment', now())`,
      [db.tenant, ids.case],
    );
    // Reproducción: preñez abierta.
    await db.query(
      `INSERT INTO pregnancies (tenant_id, animal_id, diagnosis_date, method, status) VALUES ($1,$2, CURRENT_DATE, 'ultrasound', 'open')`,
      [db.tenant, ids.pregnant],
    );
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  const list = async (params: any) => ((await herd.listAnimals({ lot: undefined, ...params })) as any).data as any[];

  it('busca por cualquier identificador (RFID, oficial) y nombre', async () => {
    expect((await list({ q: 'RF-XYZ' })).map((a) => a.id)).toEqual([ids.case]);
    expect((await list({ q: 'AR-000' })).map((a) => a.id)).toEqual([ids.pregnant]);
    expect((await list({ q: 'V-100' })).map((a) => a.id)).toEqual([ids.withdrawal]);
  });

  it('filtra por retiro sanitario activo', async () => {
    expect((await list({ withdrawal: true, lot })).map((a) => a.id)).toEqual([ids.withdrawal]);
  });

  it('filtra por caso clínico abierto', async () => {
    expect((await list({ openCase: true, lot })).map((a) => a.id)).toEqual([ids.case]);
  });

  it('filtra por preñada', async () => {
    expect((await list({ pregnant: true, lot })).map((a) => a.id)).toEqual([ids.pregnant]);
  });

  it('filtra por con/sin lote', async () => {
    const withNo = (await list({ withLot: false })).map((a) => a.id);
    expect(withNo).toContain(ids.nolot);
    const withYes = (await list({ withLot: true, lot })).map((a) => a.id);
    expect(withYes).not.toContain(ids.nolot);
  });

  it('filtra por con/sin identificador oficial', async () => {
    expect((await list({ withOfficialId: true, lot })).map((a) => a.id)).toEqual([ids.pregnant]);
    expect((await list({ withOfficialId: false, lot })).map((a) => a.id)).not.toContain(ids.pregnant);
  });

  it('filtra por origen', async () => {
    expect((await list({ origin: 'purchased', lot })).map((a) => a.id)).toEqual([ids.purchased]);
  });

  it('filtra sin pesaje reciente (incluye nunca pesados)', async () => {
    // nolot nunca fue pesado → aparece con umbral 30 días.
    expect((await list({ noRecentWeighingDays: 30 })).map((a) => a.id)).toContain(ids.nolot);
  });

  it('ordena por peso desc (nulls al final)', async () => {
    const rows = await herd.listAnimals({ lot, sort: 'weight', dir: 'desc' }) as any;
    const weights = rows.data.map((a: any) => a.last_weight_kg);
    // Primer elemento con peso es el más pesado (600); los sin peso van al final.
    const withW = weights.filter((w: number | null) => w != null);
    expect(withW[0]).toBe(600);
    expect(weights.filter((w: number | null) => w == null).length).toBeGreaterThanOrEqual(1);
    // Monótono decreciente entre los que tienen peso.
    for (let i = 1; i < withW.length; i++) expect(withW[i]).toBeLessThanOrEqual(withW[i - 1]);
  });

  it('ordena por peso con paginación keyset consistente', async () => {
    const p1: any = await herd.listAnimals({ lot, sort: 'weight', dir: 'desc', limit: 2 });
    expect(p1.data).toHaveLength(2);
    const p2: any = await herd.listAnimals({ lot, sort: 'weight', dir: 'desc', limit: 2, cursor: p1.next_cursor });
    const seen = new Set([...p1.data, ...p2.data].map((a: any) => a.id));
    expect(seen.size).toBe(p1.data.length + p2.data.length); // sin solapamiento
  });
});
