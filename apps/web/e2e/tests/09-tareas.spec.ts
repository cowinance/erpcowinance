import { test, expect } from '@playwright/test';
import { uniqueUser, registerAndAutoLogin } from '../helpers';

/**
 * E2E de la página de Tareas (P6-2.b): crear una tarea general, completarla (pasa a
 * «Cerradas · Completada») y cancelar otra (pasa a «Cancelada»). Todo online por REST.
 */
test('tareas: crear, completar y cancelar', async ({ page }) => {
  const u = uniqueUser('tareas');
  await registerAndAutoLogin(page, u);

  await page.goto('/tareas');
  await expect(page.getByRole('heading', { name: 'Tareas' })).toBeVisible();

  // Crear
  await page.getByLabel('Título').fill('Arreglar aguada norte');
  await page.getByRole('button', { name: 'Agregar tarea' }).click();
  await expect(page.getByText('Arreglar aguada norte')).toBeVisible();

  // Completar (única pendiente)
  await page.getByRole('button', { name: 'Completar' }).first().click();
  await expect(page.getByText('Completada')).toBeVisible();

  // Crear otra y cancelarla
  await page.getByLabel('Título').fill('Revisar alambrado sur');
  await page.getByRole('button', { name: 'Agregar tarea' }).click();
  await expect(page.getByText('Revisar alambrado sur')).toBeVisible();
  await page.getByRole('button', { name: 'Cancelar' }).first().click();
  await expect(page.getByText('Cancelada')).toBeVisible();
});
