import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  BASELINE_VERSION,
  checksumOf,
  loadMigrations,
  recordBaseline,
  resolveDbPath,
  runMigrations,
  type Migration,
  type MigrationDriver,
} from './migrations';

/**
 * Doble del driver: registra el SQL ejecutado y mantiene `schema_migrations` en memoria.
 * Alcanza para probar la LÓGICA del corredor (qué se aplica, en qué orden, qué aborta) sin
 * levantar una base — que es lo que ejercita la suite de integración.
 */
class FakeDriver implements MigrationDriver {
  readonly executed: string[] = [];
  applied: { version: string; name: string; checksum: string }[] = [];
  failOn: string | null = null;

  async exec(sql: string): Promise<void> {
    this.executed.push(sql);
    if (this.failOn && sql.includes(this.failOn)) throw new Error('boom');
  }

  async query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }> {
    if (sql.includes('SELECT version, checksum FROM schema_migrations'))
      return { rows: this.applied as T[] };
    if (sql.includes('INSERT INTO schema_migrations')) {
      const [version, name, checksum] = params as string[];
      if (!this.applied.some((a) => a.version === version)) this.applied.push({ version, name, checksum });
      return { rows: [] };
    }
    return { rows: [] };
  }
}

const mig = (version: string, name: string, sql: string): Migration => ({
  version,
  name,
  sql,
  checksum: checksumOf(sql),
});

describe('runMigrations', () => {
  let db: FakeDriver;
  beforeEach(() => {
    db = new FakeDriver();
  });

  it('aplica todas las pendientes en orden y las registra', async () => {
    const result = await runMigrations(db, [mig('0001', 'a', 'SELECT 1;'), mig('0002', 'b', 'SELECT 2;')]);
    expect(result.applied.map((m) => m.version)).toEqual(['0001', '0002']);
    expect(db.applied.map((a) => a.version)).toEqual(['0001', '0002']);
  });

  it('no re-aplica lo ya registrado', async () => {
    const ms = [mig('0001', 'a', 'SELECT 1;'), mig('0002', 'b', 'SELECT 2;')];
    await runMigrations(db, ms);
    const antes = db.executed.length;
    const result = await runMigrations(db, ms);
    expect(result.applied).toEqual([]);
    expect(result.skipped).toBe(2);
    // Solo el DDL de la tabla de control se vuelve a ejecutar (es IF NOT EXISTS).
    expect(db.executed.length).toBe(antes + 1);
  });

  it('aplica solo lo nuevo cuando se agrega una migración', async () => {
    await runMigrations(db, [mig('0001', 'a', 'SELECT 1;')]);
    const result = await runMigrations(db, [mig('0001', 'a', 'SELECT 1;'), mig('0002', 'b', 'SELECT 2;')]);
    expect(result.applied.map((m) => m.version)).toEqual(['0002']);
  });

  // El corazón del versionado: una migración aplicada es historia. Si se edita, esta base y una
  // base nueva describen esquemas distintos y nada más lo avisaría.
  it('aborta si cambió el checksum de una ya aplicada', async () => {
    await runMigrations(db, [mig('0001', 'a', 'SELECT 1;')]);
    await expect(runMigrations(db, [mig('0001', 'a', 'SELECT 1; -- editada')])).rejects.toThrow(
      /cambiaron en disco/,
    );
  });

  it('cada migración corre dentro de su transacción', async () => {
    await runMigrations(db, [mig('0001', 'a', 'CREATE TABLE t ();')]);
    const sql = db.executed.find((s) => s.includes('CREATE TABLE t ()'))!;
    expect(sql.startsWith('BEGIN;')).toBe(true);
    expect(sql.trimEnd().endsWith('COMMIT;')).toBe(true);
  });

  it('una migración que falla hace rollback, no se registra y corta la cadena', async () => {
    db.failOn = 'ROMPE';
    await expect(
      runMigrations(db, [mig('0001', 'ok', 'SELECT 1;'), mig('0002', 'mala', 'ROMPE;'), mig('0003', 'c', 'SELECT 3;')]),
    ).rejects.toThrow(/0002_mala/);
    expect(db.applied.map((a) => a.version)).toEqual(['0001']);
    expect(db.executed.some((s) => s.includes('ROLLBACK'))).toBe(true);
    expect(db.executed.some((s) => s.includes('SELECT 3'))).toBe(false);
  });
});

describe('recordBaseline', () => {
  it('registra el esquema canónico como 0000 y es idempotente', async () => {
    const db = new FakeDriver();
    await recordBaseline(db, 'abc');
    await recordBaseline(db, 'abc');
    expect(db.applied).toEqual([
      { version: BASELINE_VERSION, name: 'baseline_cowinance_schema', checksum: 'abc' },
    ]);
  });
});

describe('loadMigrations', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cw-mig-'));
  });

  const write = (file: string, sql: string) => writeFileSync(join(dir, file), sql);

  it('ordena por versión, no por el orden del filesystem', () => {
    write('0010_diez.sql', 'SELECT 10;');
    write('0002_dos.sql', 'SELECT 2;');
    write('0001_uno.sql', 'SELECT 1;');
    expect(loadMigrations(dir).map((m) => m.version)).toEqual(['0001', '0002', '0010']);
    rmSync(dir, { recursive: true, force: true });
  });

  it('ignora lo que no sea una migración (README, .bak, mayúsculas)', () => {
    write('0001_uno.sql', 'SELECT 1;');
    write('README.md', '# no');
    write('0002_dos.sql.bak', 'SELECT 2;');
    write('0003_Mayus.sql', 'SELECT 3;');
    expect(loadMigrations(dir).map((m) => m.name)).toEqual(['uno']);
    rmSync(dir, { recursive: true, force: true });
  });

  it('rechaza dos migraciones con la misma versión (el orden sería ambiguo)', () => {
    write('0001_uno.sql', 'SELECT 1;');
    write('0001_otra.sql', 'SELECT 2;');
    expect(() => loadMigrations(dir)).toThrow(/comparten la versión 0001/);
    rmSync(dir, { recursive: true, force: true });
  });

  it('rechaza usar la versión 0000, reservada para el esquema canónico', () => {
    write('0000_intruso.sql', 'SELECT 1;');
    expect(() => loadMigrations(dir)).toThrow(/reservada/);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('las migraciones reales del repositorio', () => {
  const migraciones = loadMigrations(resolveDbPath('migrations'));

  it('se cargan, están numeradas sin huecos y ninguna está vacía', () => {
    expect(migraciones.length).toBeGreaterThan(0);
    migraciones.forEach((m, i) => {
      expect(m.version).toBe(String(i + 1).padStart(4, '0'));
      expect(m.sql.trim().length).toBeGreaterThan(0);
    });
  });

  // Una base que ya existía (dev o producción) no tiene `schema_migrations`: el corredor ve TODO
  // como pendiente y las re-aplica. Solo es seguro si siguen siendo idempotentes.
  it('son idempotentes: nada crea sin IF NOT EXISTS ni agrega constraint sin dropearla antes', () => {
    for (const m of migraciones) {
      const sql = m.sql.replace(/--[^\n]*/g, '');
      const creaciones = sql.match(/CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX|SEQUENCE)\s+(?!IF NOT EXISTS)/gi);
      expect(creaciones, `${m.version}_${m.name}: CREATE sin IF NOT EXISTS`).toBeNull();

      for (const [, tabla, nombre] of sql.matchAll(/ALTER TABLE (\w+) ADD CONSTRAINT (\w+)/gi)) {
        const dropPrevio = new RegExp(`ALTER TABLE ${tabla} DROP CONSTRAINT IF EXISTS ${nombre}`, 'i');
        expect(dropPrevio.test(sql), `${m.version}_${m.name}: ${nombre} se agrega sin dropearla antes`).toBe(true);
      }
      for (const [, nombre, tabla] of sql.matchAll(/CREATE POLICY (\w+) ON (\w+)/gi)) {
        const dropPrevio = new RegExp(`DROP POLICY IF EXISTS ${nombre} ON ${tabla}`, 'i');
        expect(dropPrevio.test(sql), `${m.version}_${m.name}: policy ${nombre} sin DROP previo`).toBe(true);
      }
    }
  });

  // Postgres prohíbe CREATE INDEX CONCURRENTLY dentro de una transacción, y el corredor envuelve
  // cada migración en una. Si alguna vez hace falta, será una decisión explícita, no un rojo raro.
  it('ninguna usa CREATE INDEX CONCURRENTLY (el corredor las envuelve en una transacción)', () => {
    for (const m of migraciones) expect(m.sql).not.toMatch(/CONCURRENTLY/i);
  });
});
