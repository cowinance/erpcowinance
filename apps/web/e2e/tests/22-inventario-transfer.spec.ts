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

  // Anclado a la tabla de existencias: el saldo también figura en la de rotación, y sin ancla el
  // texto suelto podía encontrar la otra. Ver la nota del spec 21.
  const existencias = page.getByRole('table', { name: 'Existencias' });
  await expect(existencias.getByRole('cell', { name: '100 kg' })).toBeVisible(); // stock inicial en A

  // Transferir 40 de A → B (defaults: item Sal, origen A, destino B).
  await page.getByLabel('Cantidad a transferir').fill('40');
  await page.getByRole('button', { name: 'Transferir' }).click();

  // Por FILA, no por texto: «60 kg» y «40 kg» sueltos no dicen en qué depósito quedaron, que es
  // exactamente lo que esta prueba existe para verificar. Con dos depósitos del mismo ítem, una
  // transferencia al revés dejaría los mismos dos números y el test seguiría pasando.
  await expect(existencias.getByRole('row', { name: /Depósito A/ })).toContainText('60 kg');
  await expect(existencias.getByRole('row', { name: /Depósito B/ })).toContainText('40 kg');
});
