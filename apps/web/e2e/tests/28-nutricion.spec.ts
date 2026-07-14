import { test, expect } from '@playwright/test';
import { uniqueUser, registerAndAutoLogin } from '../helpers';
import { API_URL } from '../env';

/**
 * E2E web de Nutrición (N-3): crear una ración + componer sus ingredientes (Σ%=100) en /nutricion, y
 * entregarla a un lote en /nutricion/entregas, viendo el stock descontado en /inventario.
 */
test('nutrición: componer una ración y entregarla a un lote', async ({ page }) => {
  const u = uniqueUser('nut');
  await registerAndAutoLogin(page, u);
  const auth = { Authorization: `Bearer ${(await page.context().cookies()).find((c) => c.name === 'cw_access')?.value}` };
  const post = async (p: string, data: any) => (await page.request.post(`${API_URL}${p}`, { headers: auth, data })).json();

  const maiz = await post('/inventory/items', { name: 'Maíz', unit: 'kg', standard_cost: 0.3 });
  const soja = await post('/inventory/items', { name: 'Soja', unit: 'kg', standard_cost: 0.5 });
  const wh = await post('/inventory/warehouses', { name: 'Silo' });
  await post('/inventory/movements', { item_id: maiz.id, warehouse_id: wh.id, movement_type: 'in', quantity: 1000, unit_cost: 0.3 });
  await post('/inventory/movements', { item_id: soja.id, warehouse_id: wh.id, movement_type: 'in', quantity: 1000, unit_cost: 0.5 });
  await post('/lots', { name: 'Lote Recría' });

  // Raciones: crear y componer (60/40).
  await page.goto('/nutricion');
  await expect(page.getByRole('heading', { name: 'Nutrición' })).toBeVisible();
  await page.getByLabel('Nombre de la ración').fill('Engorde');
  await page.getByRole('button', { name: 'Agregar' }).click();
  await page.getByRole('button', { name: /Engorde/ }).click();

  await page.getByRole('button', { name: '+ Ingrediente' }).click();
  await page.getByRole('button', { name: '+ Ingrediente' }).click();
  await page.getByLabel('Ingrediente 1').selectOption({ label: 'Maíz (kg)' });
  await page.getByLabel('Porcentaje 1').fill('60');
  await page.getByLabel('Ingrediente 2').selectOption({ label: 'Soja (kg)' });
  await page.getByLabel('Porcentaje 2').fill('40');
  // "Guardar" solo se habilita cuando Σ% = 100 (Playwright espera a que sea actionable).
  await page.getByRole('button', { name: 'Guardar' }).click();
  // El costo derivado aparece en el listado (60%×0.30 + 40%×0.50 = 0.38).
  await expect(page.getByRole('button', { name: /Engorde/ })).toContainText('0.38');

  // Entregas: 100 kg al lote.
  await page.goto('/nutricion/entregas');
  await page.getByLabel('Ración').selectOption({ label: 'Engorde' });
  await page.getByLabel('Lote').selectOption({ label: 'Lote Recría' });
  await page.getByLabel('Depósito').selectOption({ label: 'Silo' });
  await page.getByLabel('Cantidad en kg').fill('100');
  await page.getByRole('button', { name: 'Entregar' }).click();
  await expect(page.getByRole('row').filter({ hasText: 'Lote Recría' })).toBeVisible();

  // El stock de maíz bajó 60 (1000 → 940).
  await page.goto('/inventario');
  await expect(page.getByText('940 kg', { exact: true })).toBeVisible();
});
