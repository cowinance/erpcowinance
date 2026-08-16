import { test, expect } from '@playwright/test';
import { uniqueUser, registerAndAutoLogin, stockCell } from '../helpers';
import { API_URL } from '../env';

/**
 * E2E web de Agricultura (AG-3): crear un cultivo sobre un potrero en /agricultura, registrar una
 * labor con insumo (consume stock) y una cosecha (a stock) en el detalle, y ver el cultivo cosechado.
 */
test('agricultura: cultivo, labor que consume stock y cosecha', async ({ page }) => {
  const u = uniqueUser('agro');
  await registerAndAutoLogin(page, u);
  const auth = { Authorization: `Bearer ${(await page.context().cookies()).find((c) => c.name === 'cw_access')?.value}` };
  const post = async (p: string, data: any) => (await page.request.post(`${API_URL}${p}`, { headers: auth, data })).json();

  await post('/paddocks', { name: 'Potrero 1', area_ha: 50 });
  const urea = await post('/inventory/items', { name: 'Urea', unit: 'kg', standard_cost: 0.6 });
  const grano = await post('/inventory/items', { name: 'Grano', unit: 'kg' });
  const wh = await post('/inventory/warehouses', { name: 'Silo agro' });
  await post('/inventory/movements', { item_id: urea.id, warehouse_id: wh.id, movement_type: 'in', quantity: 1000, unit_cost: 0.6 });

  // Cultivo.
  await page.goto('/agricultura');
  await expect(page.getByRole('heading', { name: 'Agricultura' })).toBeVisible();
  await page.getByLabel('Potrero').selectOption({ label: 'Potrero 1' });
  await page.getByLabel('Tipo de cultivo').fill('Maíz');
  await page.getByLabel('Área en hectáreas').fill('50');
  await page.getByRole('button', { name: 'Agregar cultivo' }).click();
  await page.getByRole('link', { name: 'Maíz' }).click();

  // Detalle: labor que consume urea.
  await expect(page.getByRole('heading', { name: /Maíz/ })).toBeVisible();
  await page.getByLabel('Tipo de labor').selectOption('fertilization');
  await page.getByLabel('Insumo').selectOption({ label: 'Urea (kg)' });
  // El selector arranca en «Depósito principal», que la finca nueva trae sembrado y está vacío:
  // la urea de este spec está en «Silo agro». Antes había un solo depósito y no hacía falta elegir.
  await page.getByLabel('Depósito del insumo').selectOption({ label: 'Silo agro' });
  await page.getByLabel('Cantidad del insumo').fill('200');
  await page.getByRole('button', { name: 'Registrar labor' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'Fertilización' })).toBeVisible();

  // Cosecha a stock.
  await page.getByLabel('Rinde total').fill('400000');
  await page.getByLabel('Ítem destino').selectOption({ label: 'Grano (kg)' });
  await page.getByRole('button', { name: 'Registrar cosecha' }).click();
  await expect(page.getByText('Cosechado')).toBeVisible();

  // Stock: urea 800, grano 400000.
  await page.goto('/inventario');
  await expect(stockCell(page, '800 kg')).toBeVisible();
  await expect(stockCell(page, '400000 kg')).toBeVisible();
});
