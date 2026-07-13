import { test, expect } from '@playwright/test';
import { uniqueUser, registerAndAutoLogin } from '../helpers';
import { API_URL } from '../env';

/**
 * E2E web de compras (C-4): crear una compra de ítem desde /comercial/compras, recibirla, y ver el
 * stock reflejado en /inventario (cruce de módulos comercial→inventario). Reglas en integración.
 */
test('comercial: crear compra de ítem, recibir y ver el stock', async ({ page }) => {
  const u = uniqueUser('compra');
  await registerAndAutoLogin(page, u);
  const auth = { Authorization: `Bearer ${(await page.context().cookies()).find((c) => c.name === 'cw_access')?.value}` };
  await page.request.post(`${API_URL}/commerce/partners`, { headers: auth, data: { type: 'supplier', name: 'Nutrición SA', supplier_category: 'feed' } });
  await page.request.post(`${API_URL}/inventory/items`, { headers: auth, data: { name: 'Balanceado', unit: 'kg' } });
  await page.request.post(`${API_URL}/inventory/warehouses`, { headers: auth, data: { name: 'Galpón' } });

  await page.goto('/comercial/compras');
  await expect(page.getByRole('heading', { name: 'Comercial' })).toBeVisible();

  // Alta: proveedor + una línea de ítem con depósito, cantidad y precio.
  await page.getByLabel('Proveedor').selectOption({ label: 'Nutrición SA' });
  await page.getByLabel('Ítem línea 1').selectOption({ label: 'Balanceado (kg)' });
  await page.getByLabel('Depósito línea 1').selectOption({ label: 'Galpón' });
  await page.getByLabel('Cantidad línea 1').fill('50');
  await page.getByLabel('Precio línea 1').fill('2');
  await page.getByRole('button', { name: 'Crear compra' }).click();

  // Aparece en el listado como Borrador; se recibe.
  const row = page.getByRole('listitem').filter({ hasText: 'Nutrición SA' });
  await expect(row).toBeVisible();
  await expect(row.getByText('Borrador')).toBeVisible();
  await row.getByRole('button', { name: 'Recibir' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'Nutrición SA' }).getByText('Recibida')).toBeVisible();

  // El stock entró al kardex (cruce de módulos).
  await page.goto('/inventario');
  await expect(page.getByText('50 kg', { exact: true })).toBeVisible();
});
