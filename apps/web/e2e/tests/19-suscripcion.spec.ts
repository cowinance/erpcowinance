import { test, expect } from '@playwright/test';
import { uniqueUser, registerAndAutoLogin } from '../helpers';

/**
 * E2E web de Plan y suscripción (B-1): un tenant fresco obtiene un trial (read-through), ve
 * límites vs uso, y cambia de plan (owner). Sin flujos de pago. El backend valida el gating.
 */
test('suscripción: trial read-through, límites/uso y cambio de plan', async ({ page }) => {
  const u = uniqueUser('sub');
  await registerAndAutoLogin(page, u);

  await page.goto('/suscripcion');
  await expect(page.getByRole('heading', { name: 'Plan y suscripción' })).toBeVisible();

  // Trial creado por read-through: precio 0 y límite de animales del plan trial (1000).
  await expect(page.getByText(/US\$ 0\/mes ·/)).toBeVisible();
  await expect(page.getByText(/\/ 1000/)).toBeVisible(); // límite de animales del trial
  await expect(page.getByText(/proveedor de pagos/i)).toBeVisible();

  // Cambiar a Pro (owner).
  await page.getByLabel('Elegir plan').selectOption('pro');
  await page.getByRole('button', { name: 'Cambiar plan' }).click();

  await expect(page.getByText('Plan actualizado.')).toBeVisible();
  await expect(page.getByText(/US\$ 79\/mes ·/)).toBeVisible(); // plan Pro
  await expect(page.getByText(/\/ 5000/)).toBeVisible(); // límite de animales de Pro
});
