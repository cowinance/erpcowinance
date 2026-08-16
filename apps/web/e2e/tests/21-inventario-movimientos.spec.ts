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

  /**
   * Los dos localizadores van ANCLADOS, y no por gusto: la pantalla creció y los que eran únicos
   * dejaron de serlo, sin que nadie tocara este archivo.
   *
   * `Cantidad` a secas también matchea «Cantidad a transferir», del panel de transferencias.
   * Y el saldo aparece DOS veces —acá y en la tabla de rotación—, así que buscar el texto suelto
   * encontraba la celda de la otra tabla. Anclar a la tabla nombrada dice además qué se está
   * afirmando: que el saldo quedó bien en EXISTENCIAS, que es lo que el test promete en su título.
   */
  const existencias = page.getByRole('table', { name: 'Existencias' });

  // Entrada de 100.
  await page.getByLabel('Cantidad', { exact: true }).fill('100');
  await page.getByRole('button', { name: 'Registrar' }).click();
  await expect(existencias.getByRole('cell', { name: '100 kg' })).toBeVisible();

  // Salida de 30 → saldo 70.
  await page.getByLabel('Tipo de movimiento').selectOption('out');
  await page.getByLabel('Cantidad', { exact: true }).fill('30');
  await page.getByRole('button', { name: 'Registrar' }).click();
  await expect(existencias.getByRole('cell', { name: '70 kg' })).toBeVisible();
});
