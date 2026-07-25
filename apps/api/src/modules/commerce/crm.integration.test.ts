import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { CommerceService } from './commerce.service';
import { CrmService } from './crm.service';

/**
 * CRM (F3): contactos, interacciones con seguimiento, pipeline de oportunidades y contratos con
 * vigencia, sobre la base de socios que ya existía (C-1).
 */
describe('CRM — seguimiento comercial (F3)', () => {
  let db: DbService;
  let crm: CrmService;
  let commerce: CommerceService;
  let tmp: string;
  let originalCwd: string;
  let clienteId: string;
  let otroId: string;

  const hoy = () => new Date().toISOString().slice(0, 10);
  const enDias = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'crm-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    await db.defaultFarm();
    crm = new CrmService(db);
    commerce = new CommerceService(db);

    const c: any = await commerce.createPartner({ name: 'Frigorífico del Sur', type: 'customer' });
    clienteId = c.id;
    const o: any = await commerce.createPartner({ name: 'Remate La Rural', type: 'customer' });
    otroId = o.id;
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  // ── Contactos y segmento ────────────────────────────────────────────────

  it('agrega contactos a un socio y los lista', async () => {
    await crm.addContact(clienteId, { name: 'Ana Pérez', role: 'Compras', email: 'ana@frig.test' });
    await crm.addContact(clienteId, { name: 'Luis Gómez', role: 'Logística' });
    const cs: any[] = await crm.contacts(clienteId);
    expect(cs.map((c) => c.name)).toEqual(['Ana Pérez', 'Luis Gómez']);
  });

  it('rechaza un contacto sin nombre y un socio inexistente', async () => {
    await expect(crm.addContact(clienteId, { name: '  ' })).rejects.toMatchObject({
      status: 400,
      response: { code: 'crm.missing_name' },
    });
    await expect(
      crm.addContact('00000000-0000-0000-0000-0000000000ff', { name: 'X' }),
    ).rejects.toMatchObject({ status: 404, response: { code: 'crm.partner_not_found' } });
  });

  it('segmenta al cliente', async () => {
    const r: any = await crm.setSegment(clienteId, 'frigorífico');
    expect(r.segment).toBe('frigorífico');
  });

  // ── Interacciones ───────────────────────────────────────────────────────

  it('registra una interacción con su próxima acción', async () => {
    const i: any = await crm.logInteraction({
      partner_id: clienteId,
      kind: 'call',
      summary: 'Pidió cotización por 80 novillos para agosto.',
      next_action: 'Mandar propuesta',
      next_action_at: enDias(2),
    });
    expect(i.kind).toBe('call');
    expect(i.next_action).toBe('Mandar propuesta');
  });

  it('exige contar qué se habló y rechaza tipos inventados', async () => {
    await expect(crm.logInteraction({ partner_id: clienteId, kind: 'call', summary: ' ' })).rejects.toMatchObject({
      status: 400,
      response: { code: 'crm.missing_summary' },
    });
    await expect(
      crm.logInteraction({ partner_id: clienteId, kind: 'paloma', summary: 'x' }),
    ).rejects.toMatchObject({ status: 400, response: { code: 'crm.invalid_kind' } });
  });

  // Registrar una llamada al contacto de otro cliente es un dato corrupto que después nadie encuentra.
  it('no deja asociar un contacto de otro socio', async () => {
    const [contacto]: any[] = await crm.contacts(clienteId);
    await expect(
      crm.logInteraction({ partner_id: otroId, contact_id: contacto.id, kind: 'call', summary: 'x' }),
    ).rejects.toMatchObject({ status: 400, response: { code: 'crm.contact_mismatch' } });
  });

  it('la agenda de seguimientos trae solo lo que tiene fecha, y ordenado', async () => {
    await crm.logInteraction({ partner_id: otroId, kind: 'note', summary: 'Sin seguimiento' });
    await crm.logInteraction({
      partner_id: otroId,
      kind: 'visit',
      summary: 'Visita al remate',
      next_action: 'Confirmar consignación',
      next_action_at: enDias(1),
    });
    const f: any[] = await crm.followUps();
    expect(f).toHaveLength(2);
    expect(f[0].next_action).toBe('Confirmar consignación'); // el más próximo primero
  });

  // ── Pipeline ────────────────────────────────────────────────────────────

  let oppId: string;

  it('crea una oportunidad en lead y le abre el historial', async () => {
    const o: any = await crm.createOpportunity({
      partner_id: clienteId,
      title: 'Venta 80 novillos agosto',
      expected_value: 48000,
      expected_close_date: enDias(20),
      source: 'llamado',
    });
    oppId = o.id;
    expect(o.stage).toBe('lead');
    const h: any[] = await crm.opportunityHistory(oppId);
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ from_stage: null, to_stage: 'lead' });
  });

  it('avanza de etapa y deja rastro de cada movimiento', async () => {
    await crm.moveStage(oppId, { stage: 'qualified' });
    await crm.moveStage(oppId, { stage: 'proposal', note: 'Propuesta enviada' });
    const h: any[] = await crm.opportunityHistory(oppId);
    expect(h.map((e) => e.to_stage)).toEqual(['lead', 'qualified', 'proposal']);
    expect(h[2].note).toBe('Propuesta enviada');
  });

  it('rechaza una etapa desconocida y quedarse en la misma', async () => {
    await expect(crm.moveStage(oppId, { stage: 'ganada' })).rejects.toMatchObject({
      status: 400,
      response: { code: 'crm.invalid_stage' },
    });
    await expect(crm.moveStage(oppId, { stage: 'proposal' })).rejects.toMatchObject({ status: 400 });
  });

  // Un pipeline que no enseña por qué se pierden las ventas no sirve para el próximo trimestre.
  it('no deja perder una oportunidad sin motivo', async () => {
    const o: any = await crm.createOpportunity({ partner_id: otroId, title: 'Consignación septiembre' });
    await expect(crm.moveStage(o.id, { stage: 'lost' })).rejects.toMatchObject({
      status: 400,
      response: { code: 'crm.missing_lost_reason' },
    });
    const perdida: any = await crm.moveStage(o.id, { stage: 'lost', lost_reason: 'Precio' });
    expect(perdida.lost_reason).toBe('Precio');
    expect(perdida.closed_at).toBeTruthy();
  });

  it('lo cerrado no se reabre: el histórico de conversión no puede mentir', async () => {
    const o: any = await crm.createOpportunity({ partner_id: otroId, title: 'Otra' });
    await crm.moveStage(o.id, { stage: 'won' });
    await expect(crm.moveStage(o.id, { stage: 'negotiation' })).rejects.toMatchObject({
      status: 400,
      response: { code: 'crm.invalid_stage' },
    });
  });

  it('rechaza un valor negativo o no numérico', async () => {
    await expect(
      crm.createOpportunity({ partner_id: clienteId, title: 'X', expected_value: -5 }),
    ).rejects.toMatchObject({ status: 400, response: { code: 'crm.invalid_value' } });
    await expect(
      crm.createOpportunity({ partner_id: clienteId, title: 'X', expected_value: 'mucho' }),
    ).rejects.toMatchObject({ status: 400, response: { code: 'crm.invalid_value' } });
  });

  it('filtra las oportunidades abiertas', async () => {
    const abiertas: any[] = await crm.opportunities({ open: true });
    expect(abiertas.every((o) => !['won', 'lost'].includes(o.stage))).toBe(true);
    const todas: any[] = await crm.opportunities();
    expect(todas.length).toBeGreaterThan(abiertas.length);
  });

  it('no enlaza una venta de otro socio al cerrar', async () => {
    await expect(crm.moveStage(oppId, { stage: 'won', sale_id: '00000000-0000-0000-0000-0000000000ff' })).rejects.toMatchObject({
      status: 400,
      response: { code: 'crm.sale_mismatch' },
    });
  });

  // ── Contratos ───────────────────────────────────────────────────────────

  it('crea contratos y deriva la vigencia de las fechas', async () => {
    await crm.createContract({
      partner_id: clienteId,
      type: 'supply',
      start_date: enDias(-60),
      end_date: enDias(200),
      value: 300000,
    });
    await crm.createContract({
      partner_id: clienteId,
      type: 'service',
      start_date: enDias(-300),
      end_date: enDias(10), // por vencer
      value: 50000,
    });
    await crm.createContract({
      partner_id: otroId,
      type: 'lease',
      start_date: enDias(-400),
      end_date: enDias(-30), // vencido
      value: 999,
    });

    const cs: any[] = await crm.contracts();
    const standings = cs.map((c) => c.standing).sort();
    expect(standings).toEqual(['active', 'expired', 'expiring_soon']);
  });

  it('rechaza un contrato que termina antes de empezar', async () => {
    await expect(
      crm.createContract({ partner_id: clienteId, type: 'supply', start_date: enDias(10), end_date: enDias(5) }),
    ).rejects.toMatchObject({ status: 400, response: { code: 'crm.invalid_range' } });
  });

  // Rescindir es una decisión; vencer es el paso del tiempo. La decisión gana.
  it('rescindir gana sobre las fechas', async () => {
    const [vigente] = (await crm.contracts()).filter((c: any) => c.standing === 'active') as any[];
    await crm.setContractStatus(vigente.id, 'terminated');
    const despues: any[] = await crm.contracts();
    expect(despues.find((c) => c.id === vigente.id).standing).toBe('terminated');
  });

  // ── Panel ───────────────────────────────────────────────────────────────

  it('el panel expone los cuatro indicadores del catálogo', async () => {
    const s: any = await crm.summary();
    expect(s.activeCustomers).toBeGreaterThanOrEqual(2);
    expect(s.pipeline.open).toBeGreaterThan(0);
    expect(s.pipeline.weightedValue).toBeLessThan(s.pipeline.openValue); // ponderado < nominal
    expect(s.contracts.expiringSoon).toBe(1);
    expect(s.pendingFollowUps).toBeGreaterThan(0);
  });

  it('la ventana de aviso de vencimiento es configurable', async () => {
    const corta: any = await crm.summary({ expiryWindowDays: 1 });
    const larga: any = await crm.summary({ expiryWindowDays: 365 });
    expect(corta.contracts.expiringSoon).toBe(0);
    expect(larga.contracts.expiringSoon).toBeGreaterThan(0);
  });
});
