import { test, expect } from '@playwright/test';
import { uniqueUser, registerAndAutoLogin } from '../helpers';
import { API_URL } from '../env';

/**
 * E2E web de Maquinaria (MQ-3): crear una máquina en /maquinaria y registrar una carga de combustible
 * que descuenta stock desde su detalle, viendo el stock reflejado en /inventario.
 */
test('maquinaria: crear máquina y cargar combustible que descuenta stock', async ({ page }) => {
  const u = uniqueUser('maq');
  await registerAndAutoLogin(page, u);
  const auth = { Authorization: `Bearer ${(await page.context().cookies()).find((c) => c.name === 'cw_access')?.value}` };
  const post = async (p: string, data: any) => (await page.request.post(`${API_URL}${p}`, { headers: auth, data })).json();

  const gasoil = await post('/inventory/items', { name: 'Gasoil', unit: 'l', standard_cost: 1.2 });
  const wh = await post('/inventory/warehouses', { name: 'Tanque' });
  await post('/inventory/movements', { item_id: gasoil.id, warehouse_id: wh.id, movement_type: 'in', quantity: 5000, unit_cost: 1.2 });

  // Máquina.
  await page.goto('/maquinaria');
  await expect(page.getByRole('heading', { name: 'Maquinaria' })).toBeVisible();
  await page.getByLabel('Nombre de la máquina').fill('Tractor 01');
  await page.getByRole('button', { name: 'Agregar máquina' }).click();
  await page.getByRole('link', { name: 'Tractor 01' }).click();

  // Detalle: carga de combustible que consume gasoil.
  await expect(page.getByRole('heading', { name: 'Tractor 01' })).toBeVisible();
  await page.getByLabel('Litros').fill('200');
  await page.getByLabel('Ítem de combustible').selectOption({ label: 'Gasoil (l)' });
  await page.getByRole('button', { name: 'Registrar carga' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'Gasoil' })).toBeVisible();

  // Stock: 5000 - 200 = 4800.
  await page.goto('/inventario');
  await expect(page.getByText('4800 l', { exact: true })).toBeVisible();
});
