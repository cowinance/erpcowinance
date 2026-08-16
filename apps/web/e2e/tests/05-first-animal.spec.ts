import { test, expect } from '@playwright/test';
import { uniqueUser, registerAndAutoLogin } from '../helpers';

test('tenant vacío → cargar primer animal → dashboard operativo', async ({ page }) => {
  const u = uniqueUser('anim');
  await registerAndAutoLogin(page, u);

  // Estado vacío inicial: el panel de primeros pasos (O-2) con «cargá tu hato» como siguiente.
  const cta = page.getByRole('link', { name: 'Cargar un animal' });
  await expect(cta).toBeVisible();
  await cta.click();
  await page.waitForURL('**/animales/nuevo');

  // Datos mínimos válidos, con la categoría tomada del catálogo real.
  await page.getByLabel(/Caravana/).fill('001');
  await page.getByLabel(/Categoría/).selectOption({ label: 'Vaca' });
  await page.getByRole('button', { name: 'Registrar animal' }).click();
  await page.waitForURL(/\/animales\/[0-9a-f-]{36}/); // ficha del animal creado

  /**
   * De vuelta al dashboard. Este bloque antes afirmaba que el onboarding DESAPARECÍA al cargar el
   * primer animal; O-2 (`3ca3977`) invirtió eso a propósito, y con razón: el panel se iba justo
   * cuando el productor todavía no tenía lotes, ni un pesaje, ni una sanidad. Ahora se queda y
   * avanza de paso, y se apaga solo al completar los cuatro.
   *
   * Lo que sí desaparece es la acción del paso YA HECHO: solo el siguiente muestra sus botones.
   * Esa es la señal de que el panel se derivó del estado real y no de una foto.
   */
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Cargar un animal' })).toHaveCount(0);
  await expect(page.getByText(/todavía no cargaste animales/)).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Poné tu finca en marcha' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Crear un lote' })).toBeVisible(); // avanzó al paso 2
  await expect(page.getByText('Animales activos')).toBeVisible(); // dashboard operativo

  // Al menos un animal activo: aparece en el hato.
  await page.goto('/animales');
  await expect(page.getByText('001')).toBeVisible();
});
