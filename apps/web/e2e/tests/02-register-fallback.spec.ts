import { test, expect } from '@playwright/test';
import { uniqueUser, fillRegister } from '../helpers';

test('registro con auto-login fallido → fallback a login, sin re-registrar', async ({ page }) => {
  const u = uniqueUser('fb');

  // Fallo controlado por interceptación de red — sin tocar código de producción.
  // /register llega de verdad al backend; SOLO /auth/login falla.
  let registerCalls = 0;
  await page.route('**/v1/register', async (route) => {
    registerCalls += 1;
    await route.continue();
  });
  await page.route('**/v1/auth/login', (route) =>
    route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }),
  );

  await fillRegister(page, u);
  await page.getByRole('button', { name: 'Crear cuenta' }).click();

  await expect(page.getByText('Tu cuenta fue creada')).toBeVisible();
  const loginLink = page.getByRole('link', { name: 'Iniciar sesión' });
  await expect(loginLink).toBeVisible();
  expect(registerCalls).toBe(1); // no hubo un segundo registro

  await loginLink.click();
  await page.waitForURL('**/login**');
  await expect(page.getByLabel('Email')).toHaveValue(u.email); // email prellenado

  // Verificación indirecta de que la cuenta SÍ existe: quitando el intercept,
  // el login real con esas credenciales entra al dashboard.
  await page.unroute('**/v1/auth/login');
  await page.getByLabel('Contraseña').fill(u.password);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await page.waitForURL((url) => url.pathname === '/');
  await expect(page.getByRole('link', { name: 'Cargar primer animal' })).toBeVisible();
});
