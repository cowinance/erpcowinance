import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { DocumentsService } from './documents.service';

/**
 * Integración del DMS (A6): alta de documento (archivo + metadatos), derivación de vencido/por-vencer y
 * el indicador «documentos por vencer». Se usan fechas relativas a hoy para tramos deterministas y
 * contenidos distintos para evitar el dedup por checksum entre documentos.
 */
describe('documents — DMS', () => {
  let db: DbService;
  let svc: DocumentsService;
  let originalCwd: string;
  let tmp: string;

  const pdf = (marker: string) => `data:application/pdf;base64,${Buffer.from('PDF-' + marker).toString('base64')}`;
  const day = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'documents-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    svc = new DocumentsService(db);
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('crea un documento con archivo y deriva el vencimiento', async () => {
    const d: any = await svc.create({ type: 'certificate', title: 'Certificado A', issued_by: 'SENASA', issue_date: day(-30), expiry_date: day(10), data_url: pdf('a') });
    expect(d.title).toBe('Certificado A');
    expect(d.is_expired).toBe(false);
    expect(d.days_to_expiry).toBe(10);
    expect(d.file.file_id).toBeTruthy();
    expect(d.file.token).toBeTruthy(); // ref firmada para descargar por /files/:id/content
  });

  it('rechaza tipo/título/fecha/archivo inválidos', async () => {
    await expect(svc.create({ type: 'foo', title: 'X', data_url: pdf('x') })).rejects.toMatchObject({ status: 400 });
    await expect(svc.create({ type: 'report', title: '  ', data_url: pdf('y') })).rejects.toMatchObject({ status: 400 });
    await expect(svc.create({ type: 'permit', title: 'P', issue_date: day(0), expiry_date: day(-5), data_url: pdf('z') })).rejects.toMatchObject({ status: 400 });
    await expect(svc.create({ type: 'report', title: 'Sin archivo' })).rejects.toMatchObject({ status: 400 }); // data_url faltante
    await expect(svc.create({ type: 'report', title: 'Mala data', data_url: 'data:text/plain;base64,aaaa' })).rejects.toMatchObject({ status: 400 }); // mime no permitido
  });

  it('summary cuenta vencidos y por vencer; list(expiring) los trae', async () => {
    await svc.create({ type: 'permit', title: 'Permiso vencido', expiry_date: day(-5), data_url: pdf('expired') });
    await svc.create({ type: 'contract', title: 'Contrato sin vencimiento', data_url: pdf('novto') });
    const s: any = await svc.summary();
    expect(s.expired).toBeGreaterThanOrEqual(1);
    expect(s.expiring_soon).toBeGreaterThanOrEqual(1); // el Certificado A (+10)
    const expiring: any[] = await svc.list({ expiring: 'true' });
    expect(expiring.every((x) => x.expiry_date != null && x.days_to_expiry <= 30)).toBe(true);
    expect(expiring.some((x) => x.title === 'Permiso vencido')).toBe(true); // vencido también entra (≤ hoy+30)
    expect(expiring.some((x) => x.title === 'Contrato sin vencimiento')).toBe(false); // sin vencimiento no
  });

  it('dedup por checksum: dos documentos con el mismo archivo comparten file_id', async () => {
    const a: any = await svc.create({ type: 'other', title: 'Doc 1', data_url: pdf('same') });
    const b: any = await svc.create({ type: 'other', title: 'Doc 2', data_url: pdf('same') });
    expect(a.file.file_id).toBe(b.file.file_id);
    expect(a.id).not.toBe(b.id);
  });

  it('baja: soft-delete y luego 404', async () => {
    const d: any = await svc.create({ type: 'report', title: 'Para borrar', data_url: pdf('del') });
    await expect(svc.remove(d.id)).resolves.toMatchObject({ deleted: true });
    await expect(svc.get(d.id)).rejects.toMatchObject({ status: 404 });
  });
});
