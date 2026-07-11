import { test, expect } from '@playwright/test';
import { uniqueUser, registerAndAutoLogin, login, waitForActionToken, logSize } from '../helpers';

test('recuperación + reset de contraseña (con anti-enumeración)', async ({ page, context }) => {
  const u = uniqueUser('rst');
  const newPassword = 'CowinanceE2E-Nueva-2026';

  await registerAndAutoLogin(page, u);
  await context.clearCookies(); // volvemos a estado anónimo

  const since = logSize();

  // Solicitud para un email EXISTENTE.
  await page.goto('/forgot-password');
  await page.getByLabel('Email').fill(u.email);
  await page.getByRole('button', { name: 'Enviar enlace' }).click();
  await expect(page.getByText(/Si existe una cuenta con ese email/)).toBeVisible();

  // Solicitud para un email INEXISTENTE → misma UX (anti-enum), sin pedir token.
  await page.goto('/forgot-password');
  await page.getByLabel('Email').fill(`e2e-nope-${Date.now().toString(36)}@example.test`);
  await page.getByRole('button', { name: 'Enviar enlace' }).click();
  await expect(page.getByText(/Si existe una cuenta con ese email/)).toBeVisible();

  // Token del usuario real (por destinatario + propósito reset).
  const token = await waitForActionToken(u.email, 'reset', since);

  await page.goto(`/reset-password?token=${token}`);
  await page.getByLabel('Nueva contraseña').fill(newPassword);
  await page.getByLabel('Repetir contraseña').fill(newPassword);
  await page.getByRole('button', { name: 'Guardar contraseña' }).click();
  await expect(page.getByRole('heading', { name: 'Contraseña actualizada' })).toBeVisible();

  // Reutilizar el token → inválido.
  await page.goto(`/reset-password?token=${token}`);
  await page.getByLabel('Nueva contraseña').fill(newPassword);
  await page.getByLabel('Repetir contraseña').fill(newPassword);
  await page.getByRole('button', { name: 'Guardar contraseña' }).click();
  await expect(page.getByRole('heading', { name: 'Enlace no válido' })).toBeVisible();

  // La contraseña ANTERIOR ya no sirve.
  await login(page, u.email, u.password);
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page).toHaveURL(/\/login/);

  // La contraseña NUEVA permite entrar.
  await login(page, u.email, newPassword);
  await page.waitForURL((url) => url.pathname === '/');
});
