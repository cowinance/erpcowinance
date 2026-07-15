import { test, expect } from '@playwright/test';
import { uniqueUser, registerAndAutoLogin } from '../helpers';
import { API_URL } from '../env';

/**
 * E2E web de Pastoreo (PG-2): sembrar potrero + lote por API, ingresar el lote al potrero desde
 * /pastoreo (queda ocupado), y sacarlo (queda libre). Reglas de rotación en integración.
 */
test('pastoreo: ingresar un lote a un potrero y sacarlo', async ({ page }) => {
  const u = uniqueUser('past');
  await registerAndAutoLogin(page, u);
  const auth = { Authorization: `Bearer ${(await page.context().cookies()).find((c) => c.name === 'cw_access')?.value}` };
  await page.request.post(`${API_URL}/paddocks`, { headers: auth, data: { name: 'Potrero Norte' } });
  await page.request.post(`${API_URL}/lots`, { headers: auth, data: { name: 'Rodeo 1' } });

  await page.goto('/pastoreo');
  await expect(page.getByRole('heading', { name: 'Pastoreo', exact: true })).toBeVisible();

  // Ingresar el lote al potrero.
  await page.getByLabel('Potrero').selectOption({ label: 'Potrero Norte' });
  await page.getByLabel('Lote').selectOption({ label: 'Rodeo 1' });
  await page.getByLabel('Forraje pre').fill('3000');
  await page.getByRole('button', { name: 'Ingresar' }).click();

  // El potrero queda ocupado por el rodeo.
  const occ = page.getByRole('row').filter({ hasText: 'Potrero Norte' }).first();
  await expect(occ).toContainText('Ocupado');
  await expect(occ).toContainText('Rodeo 1');

  // Sacar el lote → el potrero queda libre.
  const grazingRow = page.getByRole('row').filter({ hasText: 'Rodeo 1' }).filter({ hasText: 'Salir' });
  await grazingRow.getByRole('button', { name: 'Salir' }).click();
  await expect(page.getByRole('row').filter({ hasText: 'Potrero Norte' }).first()).toContainText('Libre');
});
