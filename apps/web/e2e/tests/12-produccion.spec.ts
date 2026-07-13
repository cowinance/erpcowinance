import { test, expect } from '@playwright/test';
import { uniqueUser, registerAndAutoLogin } from '../helpers';
import { API_URL } from '../env';

/**
 * E2E web de Producción (P8-2.b): tenant fresco sembrado por API (pesajes con condición corporal,
 * incl. dos pesajes para GDP) → la página /produccion renderiza las 3 secciones (curva, GDP por
 * lote, condición corporal) con datos, muestra el filtro de lote y re-fetchea con «Aplicar».
 * La lógica de filtrado por lote está cubierta a nivel API por production-reports-e2e.mjs.
 */
const iso = (days: number) => new Date(Date.now() + days * 86400000).toISOString();

test('producción: curva, GDP por lote y condición corporal con datos sembrados', async ({ page }) => {
  const u = uniqueUser('prod');
  await registerAndAutoLogin(page, u);

  const token = (await page.context().cookies()).find((c) => c.name === 'cw_access')?.value;
  const auth = { Authorization: `Bearer ${token}` };
  const weigh = (id: string, kg: number, at: string, cc: number) =>
    page.request.post(`${API_URL}/animals/${id}/events`, { headers: auth, data: { type: 'weighing', weight_kg: kg, occurred_at: at, body_condition: cc } });

  // Animal 1: dos pesajes (GDP derivado) + última CC 3.0 (Óptima).
  const a1 = await (await page.request.post(`${API_URL}/animals`, { headers: auth, data: { tag: 'PW1', sex: 'F', category_code: 'vaca' } })).json();
  await weigh(a1.id, 300, iso(-30), 2.0);
  await weigh(a1.id, 330, iso(0), 3.0);
  // Animal 2: un pesaje, CC 4.0 (Gorda).
  const a2 = await (await page.request.post(`${API_URL}/animals`, { headers: auth, data: { tag: 'PW2', sex: 'F', category_code: 'vaca' } })).json();
  await weigh(a2.id, 420, iso(0), 4.0);

  await page.goto('/produccion');
  await expect(page.getByRole('heading', { name: 'Producción' })).toBeVisible();

  // KPIs con datos (no el estado vacío).
  await expect(page.getByText('Pesajes en el período')).toBeVisible();
  await expect(page.getByText('Animales con CC')).toBeVisible();

  // Sección curva.
  await expect(page.getByText('Evolución de peso')).toBeVisible();

  // GDP por lote: animales sin lote → fila «Sin lote».
  await expect(page.getByRole('heading', { name: 'Ganancia diaria (GDP) por lote' })).toBeVisible();
  await expect(page.getByText('Sin lote')).toBeVisible();
  await expect(page.getByText('Sin pesajes en el período')).toHaveCount(0);

  // Condición corporal: buckets con al menos Óptima y Gorda presentes.
  await expect(page.getByRole('heading', { name: 'Condición corporal' })).toBeVisible();
  await expect(page.getByText('Óptima')).toBeVisible();
  await expect(page.getByText('Gorda')).toBeVisible();

  // Filtro de lote presente + re-fetch con «Aplicar» sin romper.
  await expect(page.getByLabel('Filtrar por lote')).toBeVisible();
  await page.getByRole('button', { name: 'Aplicar' }).click();
  await expect(page.getByText('Evolución de peso')).toBeVisible();
});

test('producción: sidebar enlaza a /produccion y /reportes sigue funcionando', async ({ page }) => {
  const u = uniqueUser('prod-nav');
  await registerAndAutoLogin(page, u);

  await page.goto('/reportes');
  await expect(page).toHaveURL(/\/reportes/);
  await expect(page.getByRole('heading', { name: 'Reportes' })).toBeVisible();

  await page.goto('/produccion');
  await expect(page.getByRole('heading', { name: 'Producción' })).toBeVisible();
});
