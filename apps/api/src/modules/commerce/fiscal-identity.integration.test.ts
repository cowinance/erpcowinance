import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { CommerceService } from './commerce.service';

/**
 * Identidad fiscal del socio de negocio (G4-1) sobre la base real.
 *
 * Lo que se fija acá es que la validación del RIF sea POR PAÍS y no global: el mismo alta que en un
 * tenant venezolano tiene que rechazarse, en uno argentino tiene que pasar. Validar el CUIT con el
 * algoritmo del RIF rechazaría identificaciones perfectamente válidas, y es un error que solo se
 * ve con dos tenants de países distintos — por eso el test cambia el país en el medio.
 */
describe('commerce — identidad fiscal del socio', () => {
  let db: DbService;
  let originalCwd: string;
  let tmp: string;

  /** Servicio nuevo por bloque: `defaultCompany()` cachea el país por tenant. */
  const nuevoServicio = () => new CommerceService(db);

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'fiscal-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  describe('tenant NO venezolano', () => {
    let svc: CommerceService;

    beforeAll(async () => {
      // El demo nace venezolano (es el caso del producto), así que el país que hay que fabricar acá
      // es el OTRO. Antes era al revés: el demo era argentino y el que se fabricaba era Venezuela.
      await db.query(`UPDATE companies SET country_code='AR' WHERE tenant_id=$1`, [db.tenant]);
      svc = nuevoServicio(); // el país va cacheado: con un servicio anterior seguiría siendo VE
    });

    it('guarda el identificador tal cual, sin aplicarle el algoritmo del RIF', async () => {
      // Un CUIT no cierra por el dígito verificador venezolano. Si acá saltara un 400, la
      // validación estaría aplicándose donde no corresponde.
      const p: any = await svc.createPartner({ type: 'customer', name: 'Frigorífico Rosario', tax_id: '30-71234567-8' });
      const full: any = await svc.getPartner(p.id);
      expect(full.tax_id).toBe('30-71234567-8');
      // Sin regla que lo valide no hay clave normalizada: NULL es «sin regla», no «sin RIF».
      expect(full.tax_id_normalized).toBeNull();
    });
  });

  describe('tenant venezolano', () => {
    let svc: CommerceService;

    beforeAll(async () => {
      // Devuelve el tenant a su país de origen, que el bloque anterior cambió.
      await db.query(`UPDATE companies SET country_code='VE' WHERE tenant_id=$1`, [db.tenant]);
      svc = nuevoServicio(); // el país va cacheado: con el servicio anterior seguiría siendo AR
    });

    it('acepta un RIF válido y lo guarda en forma canónica, se tipee como se tipee', async () => {
      const p: any = await svc.createPartner({ type: 'customer', name: 'Matadero del Llano', tax_id: 'j00123072 6' });
      const full: any = await svc.getPartner(p.id);
      expect(full.tax_id).toBe('J-00123072-6'); // así se imprime en el comprobante
      expect(full.tax_id_normalized).toBe('J001230726'); // así se compara
    });

    it('rechaza un RIF con la forma correcta y el dígito equivocado', async () => {
      // Es el caso que un regex dejaría pasar, y el que invalida el comprobante.
      await expect(svc.createPartner({ type: 'customer', name: 'Mal RIF', tax_id: 'J-00123072-4' })).rejects.toMatchObject({
        status: 400,
        response: { code: 'tax.invalid_rif.bad_check_digit' },
      });
    });

    it('dice QUÉ está mal, no solo que está mal', async () => {
      await expect(svc.createPartner({ type: 'customer', name: 'X', tax_id: 'X-00123072-6' })).rejects.toMatchObject({
        response: { code: 'tax.invalid_rif.bad_prefix' },
      });
      await expect(svc.createPartner({ type: 'customer', name: 'Y', tax_id: 'J-123-6' })).rejects.toMatchObject({
        response: { code: 'tax.invalid_rif.bad_length' },
      });
    });

    it('no exige RIF para dar de alta: se carga un cliente antes de tenerlo', async () => {
      const p: any = await svc.createPartner({ type: 'customer', name: 'Comprador de contado' });
      const full: any = await svc.getPartner(p.id);
      expect(full.tax_id).toBeNull();
      expect(full.tax_id_normalized).toBeNull();
    });

    it('el mismo RIF no entra dos veces, aunque se escriba distinto', async () => {
      // Un cliente duplicado en facturación no es una molestia de listado: son dos historias de
      // crédito fiscal para el mismo contribuyente.
      await svc.createPartner({ type: 'customer', name: 'Agropecuaria Sur', tax_id: 'J-30123456-1' });
      await expect(
        svc.createPartner({ type: 'customer', name: 'Agropecuaria Sur (otra carga)', tax_id: 'j301234561' }),
      ).rejects.toMatchObject({ status: 409, response: { code: 'commerce.duplicate_tax_id' } });
    });

    it('editar el RIF mueve las DOS columnas juntas', async () => {
      // Dejar una vieja y la otra nueva sería tener dos verdades del mismo dato.
      const p: any = await svc.createPartner({ type: 'supplier', name: 'Veterinaria Portuguesa', tax_id: 'J-29876543-7' });
      await svc.updatePartner(p.id, { tax_id: 'v12345678 1' }); // persona natural, tipeado con espacio
      const full: any = await svc.getPartner(p.id);
      expect(full.tax_id).toBe('V-12345678-1');
      expect(full.tax_id_normalized).toBe('V123456781');
    });

    it('borrar el RIF deja las dos columnas en NULL', async () => {
      const p: any = await svc.createPartner({ type: 'supplier', name: 'Sin RIF', tax_id: 'J-31234567-5' });
      await svc.updatePartner(p.id, { tax_id: null });
      const full: any = await svc.getPartner(p.id);
      expect(full.tax_id).toBeNull();
      expect(full.tax_id_normalized).toBeNull();
    });
  });

  describe('condición ante el IVA', () => {
    let svc: CommerceService;
    beforeAll(() => {
      svc = nuevoServicio();
    });

    it('se guarda y se lee', async () => {
      const p: any = await svc.createPartner({ type: 'customer', name: 'Frigorífico Especial', taxpayer_condition: 'especial' });
      const full: any = await svc.getPartner(p.id);
      expect(full.taxpayer_condition).toBe('especial');
    });

    it('rechaza una condición que no existe', async () => {
      await expect(svc.createPartner({ type: 'customer', name: 'W', taxpayer_condition: 'inventado' })).rejects.toMatchObject({
        status: 400,
        response: { code: 'tax.invalid_taxpayer_condition' },
      });
    });

    it('sin declarar queda NULL, no un valor por defecto inventado', async () => {
      // Un DEFAULT 'ordinario' afirmaría de cada cliente algo que nadie verificó, y esa mentira se
      // arrastraría al primer libro de ventas.
      const p: any = await svc.createPartner({ type: 'customer', name: 'Sin declarar' });
      const full: any = await svc.getPartner(p.id);
      expect(full.taxpayer_condition).toBeNull();
    });

    it('se puede corregir después', async () => {
      const p: any = await svc.createPartner({ type: 'customer', name: 'Corregible', taxpayer_condition: 'ordinario' });
      await svc.updatePartner(p.id, { taxpayer_condition: 'especial' });
      expect(((await svc.getPartner(p.id)) as any).taxpayer_condition).toBe('especial');
    });
  });
});
