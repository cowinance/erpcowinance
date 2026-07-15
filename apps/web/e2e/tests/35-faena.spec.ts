import { test, expect } from '@playwright/test';
import { uniqueUser, registerAndAutoLogin } from '../helpers';
import { API_URL } from '../env';

/**
 * E2E web de Faena (FA-2): con un animal pesado (500 kg) y su res (270 kg) sembrados por API, ver en
 * /faena el rendimiento DERIVADO (54%) en el listado y la sección de análisis por lote/padre.
 */
test('faena: ver el rendimiento derivado y el análisis', async ({ page }) => {
  const u = uniqueUser('faena');
  await registerAndAutoLogin(page, u);
  const auth = { Authorization: `Bearer ${(await page.context().cookies()).find((c) => c.name === 'cw_access')?.value}` };
  const post = async (p: string, data: any) => (await page.request.post(`${API_URL}${p}`, { headers: auth, data })).json();

  // Una categoría válida del catálogo para dar de alta el animal.
  const cats = await (await page.request.get(`${API_URL}/catalogs/categories`, { headers: auth })).json();
  const categoryCode = (Array.isArray(cats) ? cats : cats?.data ?? [])[0]?.code;

  const animal = await post('/animals', { tag: '9001', sex: 'M', category_code: categoryCode });
  await post(`/animals/${animal.id}/events`, { type: 'weighing', weight_kg: 500, occurred_at: '2030-05-01T10:00:00Z' });
  const carcass = await post('/slaughter/carcasses', { animal_id: animal.id, slaughter_date: '2030-05-10', hot_carcass_weight_kg: 270 });
  expect(carcass.dressing_pct).toBe(54); // regla derivada (FA-1), confirmada del lado servidor

  await page.goto('/faena');
  await expect(page.getByRole('heading', { name: 'Faena', exact: true })).toBeVisible();

  // El listado de reses muestra el rendimiento derivado.
  const row = page.getByRole('row').filter({ hasText: '9001' });
  await expect(row).toBeVisible();
  await expect(row).toContainText('270');
  await expect(row).toContainText('54%');

  // La sección de análisis está y el toggle por padre funciona.
  await expect(page.getByRole('button', { name: 'Por padre' })).toBeVisible();
  await page.getByRole('button', { name: 'Por padre' }).click();
  await expect(page.getByText('Rendimiento por padre')).toBeVisible();
});
