import { test, expect } from '@playwright/test';
import { uniqueUser, fillRegister } from '../helpers';

test('registro con auto-login fallido → fallback a login, sin re-registrar', async ({ page }) => {
  const u = uniqueUser('fb');

  // Fallo controlado por interceptación de red — sin tocar código de producción.
  // /register llega de verdad al backend; SOLO el login falla.
  //
  // Se interceptan las rutas que ve el NAVEGADOR, que ya no son las de api-core: los tokens viven
  // en cookies HttpOnly, así que el login pasa por el route handler `/api/auth/login` y el resto
  // de la API por el proxy `/api/cw`. Interceptar `**/v1/...` no atraparía nada — esas llamadas
  // ahora las hace el servidor de Next, no la página.
  let registerCalls = 0;
  await page.route('**/api/cw/register', async (route) => {
    registerCalls += 1;
    await route.continue();
  });
  await page.route('**/api/auth/login', (route) =>
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
  await page.unroute('**/api/auth/login');
  await page.getByLabel('Contraseña').fill(u.password);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await page.waitForURL((url) => url.pathname === '/');
  await expect(page.getByRole('link', { name: 'Cargar un animal' })).toBeVisible();
});
