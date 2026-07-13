import { test, expect } from '@playwright/test';
import { uniqueUser, registerAndAutoLogin } from '../helpers';
import { API_URL } from '../env';

/**
 * E2E web de transferencias (INV-2b): con stock en el depósito A, transferir a B desde /inventario
 * y ver ambas existencias reflejar el saldo. Reglas (costo viaja, sin negativo, batches) en integración.
 */
test('inventario: transferir stock entre depósitos', async ({ page }) => {
  const u = uniqueUser('invtr');
  await registerAndAutoLogin(page, u);
  const auth = { Authorization: `Bearer ${(await page.context().cookies()).find((c) => c.name === 'cw_access')?.value}` };
  const item = await (await page.request.post(`${API_URL}/inventory/items`, { headers: auth, data: { name: 'Sal', unit: 'kg' } })).json();
  const a = await (await page.request.post(`${API_URL}/inventory/warehouses`, { headers: auth, data: { name: 'Depósito A' } })).json();
  await page.request.post(`${API_URL}/inventory/warehouses`, { headers: auth, data: { name: 'Depósito B' } });
  await page.request.post(`${API_URL}/inventory/movements`, { headers: auth, data: { item_id: item.id, warehouse_id: a.id, movement_type: 'in', quantity: 100 } });

  await page.goto('/inventario');
  await expect(page.getByText('100 kg', { exact: true })).toBeVisible(); // stock inicial en A

  // Transferir 40 de A → B (defaults: item Sal, origen A, destino B).
  await page.getByLabel('Cantidad a transferir').fill('40');
  await page.getByRole('button', { name: 'Transferir' }).click();

  await expect(page.getByText('60 kg', { exact: true })).toBeVisible(); // A queda en 60
  await expect(page.getByText('40 kg', { exact: true })).toBeVisible(); // B queda en 40
});
