import { test, expect } from '@playwright/test';
import { uniqueUser, registerAndAutoLogin } from '../helpers';
import { API_URL } from '../env';

/**
 * E2E web del Tambo (TB-3): dar de alta una vaca por API, cargar su producción diaria desde /tambo y
 * ver el total del tambo del día. Entregas/calidad se cubren en integración (TB-2).
 */
test('tambo: cargar producción y ver el total del día', async ({ page }) => {
  const u = uniqueUser('tambo');
  await registerAndAutoLogin(page, u);
  const auth = { Authorization: `Bearer ${(await page.context().cookies()).find((c) => c.name === 'cw_access')?.value}` };
  const cats = await (await page.request.get(`${API_URL}/catalogs/categories`, { headers: auth })).json();
  const categoryCode = (Array.isArray(cats) ? cats : cats?.data ?? [])[0]?.code;
  await page.request.post(`${API_URL}/animals`, { headers: auth, data: { tag: '7010', sex: 'F', category_code: categoryCode } });

  await page.goto('/tambo');
  await expect(page.getByRole('heading', { name: 'Tambo', exact: true })).toBeVisible();

  // Cargar producción de la vaca.
  await page.getByLabel('Vaca').selectOption({ label: '7010' });
  await page.getByLabel('Fecha de producción').fill('2030-05-01');
  await page.getByLabel('Litros').fill('27');
  await page.getByRole('button', { name: 'Cargar' }).click();

  // El total del tambo del día aparece (1 vaca, 27 litros).
  const row = page.getByRole('row').filter({ hasText: '2030-05-01' });
  await expect(row).toBeVisible();
  await expect(row).toContainText('27');
});
