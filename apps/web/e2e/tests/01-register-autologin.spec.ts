import { test, expect } from '@playwright/test';
import { uniqueUser, fillRegister } from '../helpers';

test('registro + auto-login → dashboard vacío con nombre real, finca y banner', async ({ page }) => {
  const u = uniqueUser('reg');

  // fillRegister ya asserta que el select de países cargó (catálogo real) y elige uno conocido.
  await fillRegister(page, u, 'Argentina');

  // Quien está registrándose todavía NO tiene finca: el menú de módulos al costado no le ofrece
  // nada y le sugiere que se está perdiendo algo. `/login` lo tapaba con un `fixed inset-0`, así
  // que el problema solo se veía acá — por eso la comprobación va en el registro.
  await expect(page.locator('aside')).toHaveCount(0);

  await page.getByRole('button', { name: 'Crear cuenta' }).click();

  // Redirección al dashboard (auto-login exitoso → window.location = '/').
  await page.waitForURL((url) => url.pathname === '/');

  const firstName = u.fullName.split(' ')[0];
  await expect(page.getByRole('heading', { name: new RegExp(`Bienvenido a Cowinance, ${firstName}`) })).toBeVisible();
  await expect(page.getByText(`${u.farm} está lista`)).toBeVisible();
  // El estado vacío ya no es un CTA suelto: es el panel de primeros pasos (O-2), que sale del
  // estado real de la finca. El primero pendiente es cargar el hato, con su acción a la vista.
  await expect(page.getByRole('heading', { name: 'Poné tu finca en marcha' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Cargar un animal' })).toBeVisible();
  await expect(page.getByText('Verificá tu email')).toBeVisible();
});
