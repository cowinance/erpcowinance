import { test, expect } from '@playwright/test';
import { uniqueUser, registerAndAutoLogin } from '../helpers';

test('tenant vacío → cargar primer animal → dashboard operativo', async ({ page }) => {
  const u = uniqueUser('anim');
  await registerAndAutoLogin(page, u);

  // Estado vacío inicial + CTA.
  const cta = page.getByRole('link', { name: 'Cargar primer animal' });
  await expect(cta).toBeVisible();
  await cta.click();
  await page.waitForURL('**/animales/nuevo');

  // Datos mínimos válidos, con la categoría tomada del catálogo real.
  await page.getByLabel(/Caravana/).fill('001');
  await page.getByLabel(/Categoría/).selectOption({ label: 'Vaca' });
  await page.getByRole('button', { name: 'Registrar animal' }).click();
  await page.waitForURL(/\/animales\/[0-9a-f-]{36}/); // ficha del animal creado

  // De vuelta al dashboard: desaparece el onboarding de finca nunca poblada.
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Cargar primer animal' })).toHaveCount(0);
  await expect(page.getByText(/todavía no cargaste animales/)).toHaveCount(0);
  await expect(page.getByText('Animales activos')).toBeVisible(); // dashboard operativo

  // Al menos un animal activo: aparece en el hato.
  await page.goto('/animales');
  await expect(page.getByText('001')).toBeVisible();
});
