import { test, expect } from '@playwright/test';
import { uniqueUser, registerAndAutoLogin } from '../helpers';

/**
 * E2E web del maestro de inventario (INV-1): crear categoría → ítem (con unidad y categoría) →
 * depósito desde /inventario y verlos aparecer. Las reglas/validaciones están en integración.
 */
test('inventario: crear categoría, ítem y depósito', async ({ page }) => {
  const u = uniqueUser('inv');
  await registerAndAutoLogin(page, u);

  await page.goto('/inventario');
  await expect(page.getByRole('heading', { name: 'Inventario' })).toBeVisible();

  // Categoría.
  await page.getByLabel('Nombre de la categoría').fill('Sanitarios');
  await page.getByLabel('Tipo de categoría').selectOption('veterinary');
  await page.getByRole('button', { name: 'Agregar categoría' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'Sanitarios' })).toBeVisible();

  // Ítem (unidad + categoría recién creada).
  await page.getByLabel('Nombre del ítem').fill('Antibiótico X');
  await page.getByLabel('Categoría del ítem').selectOption({ label: 'Sanitarios' });
  await page.getByRole('button', { name: 'Agregar ítem' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'Antibiótico X' })).toBeVisible();

  // Depósito.
  await page.getByLabel('Nombre del depósito').fill('Galpón central');
  await page.getByRole('button', { name: 'Agregar depósito' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'Galpón central' })).toBeVisible();
});
