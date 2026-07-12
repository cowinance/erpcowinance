import { test, expect } from '@playwright/test';
import { uniqueUser, registerAndAutoLogin } from '../helpers';

/**
 * E2E de la agenda en el dashboard (P4-4): la Card «Atención hoy» consume GET /agenda.
 * En un tenant FRESCO (sin retiros/vacunas/preñeces) la agenda está vacía → se muestra el
 * estado «sin pendientes», confirmando que el home carga y renderiza la sección desde el
 * endpoint sin romper. El caso POBLADO (agrupado + deep-links) lo cubren agenda-e2e (API),
 * el test de integración y la verificación en navegador con datos demo.
 */
test('dashboard: «Atención hoy» renderiza la agenda (sin datos accionables → sin pendientes)', async ({ page }) => {
  const u = uniqueUser('agenda');
  await registerAndAutoLogin(page, u);

  // El dashboard operativo aparece recién con al menos un animal (si no, hay onboarding).
  await page.goto('/animales/nuevo');
  await page.getByLabel(/Caravana/).fill('001');
  await page.getByLabel(/Categoría/).selectOption({ label: 'Vaca' });
  await page.getByRole('button', { name: 'Registrar animal' }).click();
  await page.waitForURL(/\/animales\/[0-9a-f-]{36}/);

  await page.goto('/');
  // La sección existe y se alimenta de /agenda sin error.
  await expect(page.getByText('Atención hoy')).toBeVisible();
  // El animal no tiene retiros/vacunas/preñeces → agenda vacía.
  await expect(page.getByText(/sin pendientes hoy/i)).toBeVisible();
});
