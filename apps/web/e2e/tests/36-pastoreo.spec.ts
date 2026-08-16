import { test, expect } from '@playwright/test';
import { uniqueUser, registerAndAutoLogin } from '../helpers';
import { API_URL } from '../env';

/**
 * E2E web de Pastoreo (PG-2): sembrar potrero + lote por API, ingresar el lote al potrero desde
 * /pastoreo, cerrar el pastoreo, y comprobar que el potrero sigue ocupado mientras los animales
 * estén adentro. Reglas de rotación en integración.
 *
 * ESTE SPEC AFIRMABA LO CONTRARIO, y estaba mal. Esperaba que al salir el potrero quedara «Libre»,
 * porque la ocupación salía del registro de pastoreo abierto. `8d5122b` («la ocupación decía
 * "libre" sobre potreros con animales adentro») la pasó a derivarse de dónde están los LOTES, y el
 * código lo explica: se rotaron dos lotes al Potrero Norte —31 cabezas— y la pantalla seguía
 * informando todos los potreros libres.
 *
 * Es la pregunta con la que se decide a dónde mandar el rodeo mañana. Cerrar el registro es un
 * hecho administrativo; los animales no se movieron. El potrero se libera cuando el lote se va.
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

  // Cerrar el pastoreo: el registro queda con fecha de salida…
  const grazingRow = page.getByRole('row').filter({ hasText: 'Rodeo 1' }).filter({ hasText: 'Salir' });
  await grazingRow.getByRole('button', { name: 'Salir' }).click();
  await expect(page.getByRole('button', { name: 'Salir' })).toHaveCount(0);

  // …pero el potrero SIGUE ocupado, porque el lote no se movió. Cerrar el registro es papeleo;
  // los animales están donde estaban.
  await expect(page.getByRole('row').filter({ hasText: 'Potrero Norte' }).first()).toContainText('Ocupado');

  /**
   * Y se libera cuando el rodeo se va a otro potrero.
   *
   * La rotación va por `POST /lots/:id/rotate` y no por un PATCH al lote: el potrero no es un
   * campo editable, porque moverlo es mover a los animales y eso deja historial. `LotsService` lo
   * dice donde uno lo buscaría — en el `updateLot` que lo rechaza.
   */
  const otro = await (await page.request.post(`${API_URL}/paddocks`, { headers: auth, data: { name: 'Potrero Sur' } })).json();
  const lotes = await (await page.request.get(`${API_URL}/lots`, { headers: auth })).json();
  const rodeo = (Array.isArray(lotes) ? lotes : (lotes.data ?? [])).find((l: any) => l.name === 'Rodeo 1');
  await page.request.post(`${API_URL}/lots/${rodeo.id}/rotate`, { headers: auth, data: { paddock_id: otro.id } });

  await page.reload();
  await expect(page.getByRole('row').filter({ hasText: 'Potrero Norte' }).first()).toContainText('Libre');
  await expect(page.getByRole('row').filter({ hasText: 'Potrero Sur' }).first()).toContainText('Ocupado');
});
