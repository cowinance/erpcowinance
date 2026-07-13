import { test, expect } from '@playwright/test';
import { uniqueUser, registerAndAutoLogin } from '../helpers';
import { API_URL } from '../env';

/**
 * E2E web del reporte sanitario del período (P9-2): tenant fresco sembrado por API (1 vacunación,
 * 1 tratamiento, 1 muerte) → el tab «Sanidad» de /reportes muestra los indicadores del período y
 * los desgloses. Las fórmulas están cubiertas por health-report.integration.test.ts.
 */
test('reportes/sanidad: vacunaciones, tratamientos y mortalidad del período', async ({ page }) => {
  const u = uniqueUser('san');
  await registerAndAutoLogin(page, u);
  const token = (await page.context().cookies()).find((c) => c.name === 'cw_access')?.value;
  const auth = { Authorization: `Bearer ${token}` };

  const prod = await (await page.request.post(`${API_URL}/products-veterinary`, { headers: auth, data: { name: 'AftosaRV', type: 'vaccine' } })).json();
  const a1 = await (await page.request.post(`${API_URL}/animals`, { headers: auth, data: { tag: 'SN1', sex: 'M', category_code: 'novillo' } })).json();
  const a2 = await (await page.request.post(`${API_URL}/animals`, { headers: auth, data: { tag: 'SN2', sex: 'M', category_code: 'novillo' } })).json();
  await page.request.post(`${API_URL}/vaccinations`, { headers: auth, data: { animal_id: a1.id, product_id: prod.id } });
  await page.request.post(`${API_URL}/treatments`, { headers: auth, data: { animal_id: a1.id, product_id: prod.id, route: 'im' } });
  await page.request.post(`${API_URL}/mortalities`, { headers: auth, data: { animal_id: a2.id } });

  await page.goto('/reportes');
  await expect(page.getByRole('heading', { name: 'Reportes' })).toBeVisible();
  await page.getByRole('button', { name: 'Sanidad' }).click();

  // Indicadores del período.
  await expect(page.getByText('Vacunaciones')).toBeVisible();
  await expect(page.getByText('Tratamientos', { exact: true })).toBeVisible();
  await expect(page.getByText('Mortalidad')).toBeVisible();

  // Desgloses.
  await expect(page.getByText('Vacunas por producto')).toBeVisible();
  await expect(page.getByText('AftosaRV')).toBeVisible();
  await expect(page.getByText('Tratamientos por vía')).toBeVisible();

  // Nota: el snapshot a-fecha vive en Alertas.
  await expect(page.getByText(/cobertura de vacunación y los animales en retiro/i)).toBeVisible();
});
