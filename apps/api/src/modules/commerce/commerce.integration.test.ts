import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { CommerceService } from './commerce.service';

/**
 * Integración del maestro comercial (C-1): supertipo business_partners + satélites suppliers/customers
 * (1:1) según `type`, contactos y validaciones. `db.tenant` cae al tenant demo.
 */
describe('commerce — maestro de socios', () => {
  let db: DbService;
  let svc: CommerceService;
  let originalCwd: string;
  let tmp: string;

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'commerce-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    svc = new CommerceService(db);
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('crea supplier: business_partner + satélite suppliers, sin customers; valida type y enums', async () => {
    // `tax_id` es un RIF VÁLIDO y no un `'30-1'` cualquiera: la demo es venezolana, así que el alta
    // pasa por `resolveFiscalId` y el dígito verificador se comprueba de verdad. Este test no es
    // sobre identidad fiscal —eso vive en `fiscal-identity.integration.test.ts`— pero un socio se
    // da de alta con su RIF, y el dato tiene que ser posible.
    const p: any = await svc.createPartner({ type: 'supplier', name: '  Nutrición SA  ', supplier_category: 'feed', supplier_terms: 30, tax_id: 'J-31456789-6' });
    const full: any = await svc.getPartner(p.id);
    expect(full.name).toBe('Nutrición SA');
    expect(full.type).toBe('supplier');
    expect(full.supplier_category).toBe('feed');
    expect(full.supplier_terms).toBe(30);
    expect(full.customer_segment).toBeNull(); // no hay satélite customer

    await expect(svc.createPartner({ type: 'no-existe', name: 'X' })).rejects.toMatchObject({ status: 400 });
    await expect(svc.createPartner({ type: 'supplier', name: '  ' })).rejects.toMatchObject({ status: 400 });
    await expect(svc.createPartner({ type: 'supplier', name: 'Y', supplier_category: 'invent' })).rejects.toMatchObject({ status: 400 });
    await expect(svc.createPartner({ type: 'customer', name: 'Z', customer_segment: 'invent' })).rejects.toMatchObject({ status: 400 });
  });

  it('type=both crea ambos satélites; y volver a supplier archiva el satélite customer', async () => {
    const p: any = await svc.createPartner({ type: 'both', name: 'Frigorífico Central', supplier_category: 'services', customer_segment: 'slaughterhouse' });
    let full: any = await svc.getPartner(p.id);
    expect(full.supplier_category).toBe('services');
    expect(full.customer_segment).toBe('slaughterhouse');

    // both → supplier: el lado customer se da de baja lógica, el supplier persiste.
    await svc.updatePartner(p.id, { type: 'supplier' });
    full = await svc.getPartner(p.id);
    expect(full.type).toBe('supplier');
    expect(full.supplier_category).toBe('services');
    expect(full.customer_segment).toBeNull();

    // supplier → both otra vez: el satélite customer se reactiva (UPSERT reactivando deleted_at).
    await svc.updatePartner(p.id, { type: 'both', customer_segment: 'auction' });
    full = await svc.getPartner(p.id);
    expect(full.customer_segment).toBe('auction');
  });

  it('lista por type incluye a los `both`; edita campos del supertipo', async () => {
    const c: any = await svc.createPartner({ type: 'customer', name: 'Remate del Sur', customer_segment: 'auction' });
    const asCustomers = await svc.listPartners('customer');
    const asSuppliers = await svc.listPartners('supplier');
    expect(asCustomers.find((x: any) => x.id === c.id)).toBeTruthy();
    expect(asSuppliers.find((x: any) => x.id === c.id)).toBeFalsy();

    const upd: any = await svc.updatePartner(c.id, { name: 'Remate del Sur SRL', email: 'v@x.com' });
    expect(upd.id).toBe(c.id);
    expect((await svc.getPartner(c.id) as any).email).toBe('v@x.com');
  });

  it('contactos: alta bajo un socio y baja; borrar socio da de baja satélites y contactos', async () => {
    const p: any = await svc.createPartner({ type: 'both', name: 'Agro Integral' });
    const contact: any = await svc.createContact(p.id, { name: 'Juan Pérez', role: 'Compras', email: 'j@x.com' });
    let full: any = await svc.getPartner(p.id);
    expect(full.contacts.map((x: any) => x.id)).toContain(contact.id);

    await svc.deleteContact(contact.id);
    full = await svc.getPartner(p.id);
    expect(full.contacts.length).toBe(0);
    await expect(svc.createContact('00000000-0000-0000-0000-000000000000', { name: 'x' })).rejects.toMatchObject({ status: 404 });

    await svc.deletePartner(p.id);
    await expect(svc.getPartner(p.id)).rejects.toMatchObject({ status: 404 });
    await expect(svc.deletePartner(p.id)).rejects.toMatchObject({ status: 404 });
  });
});
