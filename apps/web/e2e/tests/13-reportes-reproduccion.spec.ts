import { test, expect } from '@playwright/test';
import { uniqueUser, registerAndAutoLogin } from '../helpers';
import { API_URL } from '../env';

/**
 * E2E web de los índices reproductivos del período (P9-1): tenant fresco sembrado por API
 * (1 preñada + 1 vacía → % preñez 50; 2 servicios → servicios/preñez 2) → el tab «Reproducción»
 * de /reportes muestra las 3 tarjetas de índices período-scoped. Las fórmulas están cubiertas por
 * reproduction-indices.integration.test.ts; acá se valida la superficie web.
 */
test('reportes/reproducción: índices del período (% preñez, IEP, servicios/preñez)', async ({ page }) => {
  const u = uniqueUser('repro');
  await registerAndAutoLogin(page, u);
  const token = (await page.context().cookies()).find((c) => c.name === 'cw_access')?.value;
  const auth = { Authorization: `Bearer ${token}` };

  const a1 = await (await page.request.post(`${API_URL}/animals`, { headers: auth, data: { tag: 'RV1', sex: 'F', category_code: 'vaca' } })).json();
  const a2 = await (await page.request.post(`${API_URL}/animals`, { headers: auth, data: { tag: 'RV2', sex: 'F', category_code: 'vaca' } })).json();
  await page.request.post(`${API_URL}/animals/${a1.id}/services`, { headers: auth, data: { method: 'ai' } });
  await page.request.post(`${API_URL}/animals/${a2.id}/services`, { headers: auth, data: { method: 'natural' } });
  await page.request.post(`${API_URL}/pregnancy-diagnoses`, { headers: auth, data: { animal_id: a1.id, result: 'pregnant' } });
  await page.request.post(`${API_URL}/pregnancy-diagnoses`, { headers: auth, data: { animal_id: a2.id, result: 'empty' } });

  await page.goto('/reportes');
  await expect(page.getByRole('heading', { name: 'Reportes' })).toBeVisible();
  await page.getByRole('button', { name: 'Reproducción' }).click();

  // Índices período-scoped.
  await expect(page.getByText('% Preñez')).toBeVisible();
  await expect(page.getByText('1/2 diagnósticos del período')).toBeVisible();
  await expect(page.getByText('50%')).toBeVisible();
  await expect(page.getByText('IEP', { exact: true })).toBeVisible();
  await expect(page.getByText('Servicios / preñez')).toBeVisible();
  await expect(page.getByText('Indicadores calculados sobre el período filtrado.')).toBeVisible();

  // El snapshot «Vientres preñados» NO vive en el reporte (opción 1).
  await expect(page.getByText('Vientres preñados')).toHaveCount(0);
});
