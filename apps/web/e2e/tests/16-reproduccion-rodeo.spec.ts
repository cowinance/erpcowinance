import { test, expect } from '@playwright/test';
import { uniqueUser, registerAndAutoLogin } from '../helpers';
import { API_URL } from '../env';

/**
 * E2E web del estado del rodeo (R-1): tenant fresco con un vientre por estado (preñada, servida,
 * vacía, sin actividad) → la sección «Estado del rodeo» de /reproduccion muestra la franja de
 * conteos y la tabla. Las fórmulas están cubiertas por herd-status.integration.test.ts.
 */
test('reproducción/rodeo: estado por vientre y conteos', async ({ page }) => {
  const u = uniqueUser('rodeo');
  await registerAndAutoLogin(page, u);
  const token = (await page.context().cookies()).find((c) => c.name === 'cw_access')?.value;
  const auth = { Authorization: `Bearer ${token}` };
  const mkVaca = async (tag: string) => (await page.request.post(`${API_URL}/animals`, { headers: auth, data: { tag, sex: 'F', category_code: 'vaca' } })).json();

  const vPreg = await mkVaca('RS1');
  const vServed = await mkVaca('RS2');
  const vEmpty = await mkVaca('RS3');
  await mkVaca('RS4'); // sin actividad
  await page.request.post(`${API_URL}/pregnancy-diagnoses`, { headers: auth, data: { animal_id: vPreg.id, result: 'pregnant' } });
  await page.request.post(`${API_URL}/animals/${vServed.id}/services`, { headers: auth, data: { method: 'ai' } });
  await page.request.post(`${API_URL}/pregnancy-diagnoses`, { headers: auth, data: { animal_id: vEmpty.id, result: 'empty' } });

  await page.goto('/reproduccion');
  await expect(page.getByRole('heading', { name: 'Estado del rodeo' })).toBeVisible();

  // Total de vientres del rodeo.
  await expect(page.getByText('4 vientres', { exact: true })).toBeVisible();

  // El estado ahora es DERIVADO y rico (13 estados con badge, mejora de Reproducción): la franja
  // resume solo los ACCIONABLES —pregnant/due_soon/diagnosis_pending/ready_for_service/open/
  // repeat_breeder—, así que se afirma el que es determinista con estos datos: la diagnosticada
  // preñada. (Antes se afirmaban etiquetas «Preñada:»/«Servida:» de la franja vieja.)
  // Aparece dos veces (badge de la franja + fila de RS1 en el roster); alcanza con la primera.
  await expect(page.getByText('Preñada', { exact: true }).first()).toBeVisible();

  // Tabla del roster: los 4 vientres aparecen, incluido RS4 (sin actividad), que no está en
  // «Próximos partos».
  for (const tag of ['RS1', 'RS2', 'RS3', 'RS4']) {
    await expect(page.getByRole('link', { name: tag })).toBeVisible();
  }
});
