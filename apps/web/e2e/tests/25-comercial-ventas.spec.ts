import { test, expect } from '@playwright/test';
import { uniqueUser, registerAndAutoLogin } from '../helpers';
import { API_URL } from '../env';

/**
 * E2E web de ventas (C-4): con stock inicial, crear una venta de ítem desde /comercial/ventas,
 * entregarla, y ver el stock descontado en /inventario. La venta de animal (→ sold convergente)
 * está cubierta en integración. Reglas en integración.
 */
test('comercial: crear venta de ítem, entregar y ver el stock descontado', async ({ page }) => {
  const u = uniqueUser('venta');
  await registerAndAutoLogin(page, u);
  const auth = { Authorization: `Bearer ${(await page.context().cookies()).find((c) => c.name === 'cw_access')?.value}` };
  await page.request.post(`${API_URL}/commerce/partners`, { headers: auth, data: { type: 'customer', name: 'Frigorífico Sur', customer_segment: 'slaughterhouse' } });
  const item = await (await page.request.post(`${API_URL}/inventory/items`, { headers: auth, data: { name: 'Ración', unit: 'kg' } })).json();
  const wh = await (await page.request.post(`${API_URL}/inventory/warehouses`, { headers: auth, data: { name: 'Depósito' } })).json();
  await page.request.post(`${API_URL}/inventory/movements`, { headers: auth, data: { item_id: item.id, warehouse_id: wh.id, movement_type: 'in', quantity: 80, unit_cost: 3 } });

  await page.goto('/comercial/ventas');
  await expect(page.getByRole('heading', { name: 'Comercial' })).toBeVisible();

  // Alta: cliente + tipo producto + línea de ítem.
  await page.getByLabel('Cliente').selectOption({ label: 'Frigorífico Sur' });
  await page.getByLabel('Tipo de venta').selectOption('product');
  await page.getByLabel('Ítem línea 1').selectOption({ label: 'Ración (kg)' });
  await page.getByLabel('Cantidad línea 1').fill('30');
  await page.getByLabel('Precio línea 1').fill('10');
  await page.getByRole('button', { name: 'Crear venta' }).click();

  const row = page.getByRole('listitem').filter({ hasText: 'Frigorífico Sur' });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Entregar' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'Frigorífico Sur' }).getByText('Entregada')).toBeVisible();

  // El stock quedó en 80 - 30 = 50.
  await page.goto('/inventario');
  await expect(page.getByText('50 kg', { exact: true })).toBeVisible();
});
