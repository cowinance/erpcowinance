import { test, expect } from '@playwright/test';
import { uniqueUser, registerAndAutoLogin } from '../helpers';

/**
 * E2E web del maestro comercial (C-1): crear un proveedor y un socio `both` desde /comercial y verlos
 * en el listado con su badge de tipo. Las reglas (satélites 1:1, enums, RLS) están en integración.
 */
test('comercial: crear proveedor y socio "ambos"', async ({ page }) => {
  const u = uniqueUser('com');
  await registerAndAutoLogin(page, u);

  await page.goto('/comercial');
  await expect(page.getByRole('heading', { name: 'Comercial' })).toBeVisible();

  // Proveedor (aparece el select de rubro, no el de segmento).
  await page.getByLabel('Tipo de socio').selectOption('supplier');
  await page.getByLabel('Nombre del socio').fill('Nutrición del Litoral');
  await page.getByLabel('Identificación fiscal').fill('30-11111111-7');
  await page.getByLabel('Rubro de proveedor').selectOption('feed');
  await expect(page.getByLabel('Segmento de cliente')).toHaveCount(0);
  await page.getByRole('button', { name: 'Agregar socio' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: 'Nutrición del Litoral' })).toBeVisible();

  // Socio `both`: aparecen ambos selects.
  await page.getByLabel('Tipo de socio').selectOption('both');
  await page.getByLabel('Nombre del socio').fill('Frigorífico Central');
  await expect(page.getByLabel('Rubro de proveedor')).toBeVisible();
  await page.getByLabel('Segmento de cliente').selectOption('slaughterhouse');
  await page.getByRole('button', { name: 'Agregar socio' }).click();

  const both = page.getByRole('listitem').filter({ hasText: 'Frigorífico Central' });
  await expect(both).toBeVisible();
  await expect(both.getByText('Ambos')).toBeVisible();
});
