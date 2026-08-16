import { test, expect } from '@playwright/test';
import { uniqueUser, registerAndAutoLogin, waitForActionToken, logSize } from '../helpers';

test('verificación de email: éxito, reuso inválido, y el banner desaparece', async ({ page }) => {
  const u = uniqueUser('vf');
  const since = logSize();

  await registerAndAutoLogin(page, u);
  await expect(page.getByText('Verificá tu email')).toBeVisible();

  // Antes de verificar, el banner tiene que RESPONDER. Los dos botones siempre hicieron lo suyo
  // —revalidar y reenviar— pero callaban el resultado: «Ya verifiqué» sobre una cuenta sin
  // verificar dejaba la pantalla idéntica a la de antes de tocarlo, o sea indistinguible de un
  // botón roto. Este server e2e corre con EMAIL_PROVIDER=log, así que además tiene que avisar que
  // el correo no sale: sin eso se espera para siempre un enlace que nadie va a enviar.
  await expect(page.getByText(/no está configurado para enviar correo/).first()).toBeVisible();
  await page.getByRole('button', { name: 'Ya verifiqué' }).click();
  await expect(page.getByText(/Todavía figura sin verificar/).first()).toBeVisible();

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
  await expect(page.getByRole('link', { name: 'Cargar un animal' })).toBeVisible();
});
