import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { DbService } from '../../db/db.service';
import { SyncHandlerRegistry } from './registry/sync-handler.registry';
import { SyncService } from './sync.service';
import { BillingService } from '../billing/billing.service';

/**
 * Integración del registro de push token (P7-2.a): setPushToken persiste el token en
 * sync_devices, es idempotente, aísla por tenant+usuario (no toca el device de otro), y
 * respeta «un token, un device» (al registrarlo lo despega de otras filas del usuario).
 */
describe('SyncService.setPushToken · integración', () => {
  let db: DbService;
  let sync: SyncService;
  let tenantId: string;
  let userId: string;
  let otherUserId: string;
  let originalCwd: string;
  let tmp: string;

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'pushtok-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    sync = new SyncService(db, new SyncHandlerRegistry(), new BillingService(db));
    tenantId = (await db.query<{ id: string }>(`SELECT id FROM organizations ORDER BY created_at LIMIT 1`))[0].id;
    userId = (await db.query<{ id: string }>(`SELECT id FROM users WHERE email = 'cowinance@gmail.com'`))[0].id;
    // El segundo tenant de la demo (antes 'maria@elombu.com', cuando la finca era argentina).
    otherUserId = (await db.query<{ id: string }>(`SELECT id FROM users WHERE email = 'maria@elsaman.com'`))[0].id;
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  const register = async () => ((await sync.registerDevice({ platform: 'android' })) as any).id as string;
  const tokenOf = async (id: string) => (await db.query<{ push_token: string | null }>(`SELECT push_token FROM sync_devices WHERE id = $1`, [id]))[0]?.push_token;

  it('setea el push token del device (persistido, idempotente)', async () => {
    const d = await register();
    const res = await sync.setPushToken(d, 'ExponentPushToken[AAA]');
    expect(res).toMatchObject({ id: d, push_token_registered: true });
    expect(await tokenOf(d)).toBe('ExponentPushToken[AAA]');
    await sync.setPushToken(d, 'ExponentPushToken[AAA]'); // idempotente
    expect(await tokenOf(d)).toBe('ExponentPushToken[AAA]');
  });

  it('un token, un device: al registrarlo en otro device se despega del anterior', async () => {
    const d1 = await register();
    const d2 = await register();
    await sync.setPushToken(d1, 'ExponentPushToken[MOVE]');
    expect(await tokenOf(d1)).toBe('ExponentPushToken[MOVE]');
    await sync.setPushToken(d2, 'ExponentPushToken[MOVE]');
    expect(await tokenOf(d2)).toBe('ExponentPushToken[MOVE]');
    expect(await tokenOf(d1)).toBeNull(); // despegado
  });

  it('token vacío → missing_push_token', async () => {
    const d = await register();
    await expect(sync.setPushToken(d, '')).rejects.toMatchObject({ response: { code: 'sync.missing_push_token' } });
  });

  it('device inexistente → device_not_found', async () => {
    await expect(sync.setPushToken(randomUUID(), 'x')).rejects.toMatchObject({ response: { code: 'sync.device_not_found' } });
  });

  it('device de otro usuario → device_not_found (no lo toca)', async () => {
    const foreign = (
      await db.query<{ id: string }>(
        `INSERT INTO sync_devices (tenant_id, user_id, platform) VALUES ($1,$2,'ios') RETURNING id`,
        [tenantId, otherUserId],
      )
    )[0].id;
    await expect(sync.setPushToken(foreign, 'x')).rejects.toMatchObject({ response: { code: 'sync.device_not_found' } });
    expect(await tokenOf(foreign)).toBeNull();
  });
});
