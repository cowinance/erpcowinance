import { test, expect } from '@playwright/test';
import { uniqueUser, registerAndAutoLogin } from '../helpers';
import { API_URL } from '../env';

/**
 * E2E web del kardex (INV-2a): registrar una entrada y una salida desde /inventario y ver las
 * existencias reflejar el saldo. Las reglas (avg_cost, sin negativo, signos) están en integración.
 */
test('inventario: registrar entrada y salida, existencias reflejan el saldo', async ({ page }) => {
  const u = uniqueUser('invmov');
  await registerAndAutoLogin(page, u);
  const auth = { Authorization: `Bearer ${(await page.context().cookies()).find((c) => c.name === 'cw_access')?.value}` };
  await page.request.post(`${API_URL}/inventory/items`, { headers: auth, data: { name: 'Maíz', unit: 'kg' } });
  await page.request.post(`${API_URL}/inventory/warehouses`, { headers: auth, data: { name: 'Galpón' } });

  await page.goto('/inventario');
  await expect(page.getByRole('heading', { name: 'Inventario' })).toBeVisible();

  // Entrada de 100.
  await page.getByLabel('Cantidad').fill('100');
  await page.getByRole('button', { name: 'Registrar' }).click();
  await expect(page.getByText('100 kg', { exact: true })).toBeVisible();

  // Salida de 30 → saldo 70.
  await page.getByLabel('Tipo de movimiento').selectOption('out');
  await page.getByLabel('Cantidad').fill('30');
  await page.getByRole('button', { name: 'Registrar' }).click();
  await expect(page.getByText('70 kg', { exact: true })).toBeVisible();
});
