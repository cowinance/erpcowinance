import { test, expect } from '@playwright/test';
import { uniqueUser, registerAndAutoLogin, waitForActionToken, logSize } from '../helpers';

test('verificación de email: éxito, reuso inválido, y el banner desaparece', async ({ page }) => {
  const u = uniqueUser('vf');
  const since = logSize();

  await registerAndAutoLogin(page, u);
  await expect(page.getByText('Verificá tu email')).toBeVisible();

  // Sólo el email de verificación de ESTE usuario (por destinatario + propósito).
  const token = await waitForActionToken(u.email, 'verify', since);

  await page.goto(`/verify-email?token=${token}`);
  await expect(page.getByRole('heading', { name: 'Email verificado' })).toBeVisible();

  // Reutilizar el token (single-use) → inválido.
  await page.goto(`/verify-email?token=${token}`);
  await expect(page.getByText(/no es válido, expiró o ya se usó/)).toBeVisible();

  // De vuelta al dashboard: el banner ya no aparece (server ve email_verified=true).
  await page.goto('/');
  await expect(page.getByText('Verificá tu email')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Cargar primer animal' })).toBeVisible();
});
