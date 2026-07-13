import { test, expect } from '@playwright/test';
import { uniqueUser, registerAndAutoLogin } from '../helpers';

/**
 * E2E web de protocolos reproductivos (R-2.a): desde /reproduccion se llega a la administración de
 * protocolos, se crea una plantilla con un paso y se archiva. Las reglas (validación, CRUD, RLS)
 * están cubiertas por los tests de dominio/integración/.mjs.
 */
test('protocolos: crear y archivar una plantilla', async ({ page }) => {
  const u = uniqueUser('proto');
  await registerAndAutoLogin(page, u);

  await page.goto('/reproduccion');
  await page.getByRole('link', { name: 'Protocolos IATF →' }).click();
  await expect(page.getByRole('heading', { name: 'Protocolos reproductivos' })).toBeVisible();
  await expect(page.getByText('Sin protocolos todavía. Creá el primero →')).toBeVisible();

  // Alta: nombre + un paso (día 0, acción).
  await page.getByPlaceholder('IATF 10 días').fill('IATF Test');
  await page.getByPlaceholder('Acción').first().fill('Implante');
  await page.getByRole('button', { name: 'Crear protocolo' }).click();

  // Aparece en la lista con su paso.
  await expect(page.getByText('IATF Test')).toBeVisible();
  await expect(page.getByText('Día 0: Implante')).toBeVisible();

  // Archivar → desaparece.
  await page.getByRole('button', { name: 'Archivar' }).click();
  await expect(page.getByText('IATF Test')).toHaveCount(0);
  await expect(page.getByText('Sin protocolos todavía. Creá el primero →')).toBeVisible();
});
