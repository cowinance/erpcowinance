import { test, expect } from '@playwright/test';
import { uniqueUser, registerAndAutoLogin } from '../helpers';

/**
 * E2E del tablero de Tareas: crear una tarea general, completarla (pasa a la pestaña
 * «Completadas») y cancelar otra (pasa a «Canceladas»). Todo online por REST.
 *
 * Actualizado a la mejora «Tareas → centro operativo»: el alta vive detrás de «+ Nueva tarea»,
 * las tareas se agrupan en pestañas por urgencia (al crear, el tablero salta a la pestaña donde
 * cayó la tarea) y las acciones menos frecuentes —cancelar, reprogramar, asignar— están bajo «⋯».
 */
test('tareas: crear, completar y cancelar', async ({ page }) => {
  const u = uniqueUser('tareas');
  await registerAndAutoLogin(page, u);

  await page.goto('/tareas');
  await expect(page.getByRole('heading', { name: 'Tareas' })).toBeVisible();

  const crear = async (titulo: string) => {
    await page.getByRole('button', { name: '+ Nueva tarea' }).click();
    await page.getByLabel('Título').fill(titulo);
    await page.getByRole('button', { name: 'Crear tarea' }).click();
    // Sin fecha → cae en «Sin fecha»; el tablero cambia solo a esa pestaña para que se vea.
    await expect(page.getByText(titulo)).toBeVisible();
  };

  // Crear y completar.
  await crear('Arreglar aguada norte');
  await page.getByRole('button', { name: 'Completar' }).first().click();
  await expect(page.getByText('Arreglar aguada norte')).toHaveCount(0); // sale de las abiertas
  await page.getByRole('button', { name: 'Completadas' }).click();
  await expect(page.getByText('Arreglar aguada norte')).toBeVisible();

  // Crear otra y cancelarla (cancelar pide confirmación).
  await crear('Revisar alambrado sur');
  await page.getByRole('button', { name: '⋯' }).first().click();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Cancelar tarea' }).click();
  await expect(page.getByText('Revisar alambrado sur')).toHaveCount(0);
  await page.getByRole('button', { name: 'Canceladas' }).click();
  await expect(page.getByText('Revisar alambrado sur')).toBeVisible();
});
