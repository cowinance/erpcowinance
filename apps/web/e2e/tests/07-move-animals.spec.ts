import { test, expect } from '@playwright/test';
import { uniqueUser, registerAndAutoLogin } from '../helpers';

/**
 * E2E de la UI de movimiento (P3 M-2.2): selección múltiple en la lista → barra de
 * acción → MoveDialog → POST /movements. Tenant fresco (sin lotes creados), así que
 * el destino disponible es «Sacar del lote» (lot_id:null); el movimiento a un lote
 * concreto lo cubren move-rest-e2e (API) y la verificación en navegador con datos demo.
 * Aquí se verifica el cableado de la UI end-to-end: selección, diálogo y escritura.
 */
async function createAnimal(page: import('@playwright/test').Page, tag: string) {
  await page.goto('/animales/nuevo');
  await page.getByLabel(/Caravana/).fill(tag);
  await page.getByLabel(/Categoría/).selectOption({ label: 'Vaca' });
  await page.getByRole('button', { name: 'Registrar animal' }).click();
  await page.waitForURL(/\/animales\/[0-9a-f-]{36}/);
}

test('lista: selección múltiple → diálogo Mover → POST /movements', async ({ page }) => {
  const u = uniqueUser('mov');
  await registerAndAutoLogin(page, u);
  await createAnimal(page, 'MV-1');
  await createAnimal(page, 'MV-2');

  await page.goto('/animales');

  // El listado ahora carga los animales desde el navegador (filtros/orden/paginación en cliente),
  // así que hay que esperar a que lleguen las filas: si no, «Seleccionar todos» marca una lista vacía.
  await expect(page.getByRole('link', { name: /MV-1/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /MV-2/ })).toBeVisible();

  // Seleccionar todos (2 animales del tenant fresco) → barra de acción.
  await page.getByRole('checkbox', { name: 'Seleccionar todos' }).check();
  await expect(page.getByText('2 seleccionados')).toBeVisible();

  // Abrir el diálogo desde la barra.
  await page.getByRole('button', { name: 'Mover' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Mover 2 animales')).toBeVisible();

  // Sin lotes en el tenant → «Sacar del lote» (siempre disponible); confirma la escritura.
  await page.getByLabel('Destino').selectOption('clear');
  const [resp] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/movements') && r.request().method() === 'POST'),
    dialog.getByRole('button', { name: 'Mover' }).click(),
  ]);
  expect(resp.status()).toBe(201);

  // El diálogo cierra tras el éxito.
  await expect(dialog).toHaveCount(0);
});
