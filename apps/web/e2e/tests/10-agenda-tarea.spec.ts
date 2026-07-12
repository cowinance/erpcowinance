import { test, expect } from '@playwright/test';
import { uniqueUser, registerAndAutoLogin } from '../helpers';
import { API_URL } from '../env';

/**
 * E2E de «Atención hoy» accionable (P6-2.c): una tarea de Sanidad vencible hoy aparece en la
 * agenda del dashboard con un botón «Completar»; al completarla (POST /tasks/:id/complete)
 * desaparece. La tarea de salud se siembra por API (crear plan + aplicarlo con offset 0).
 */
test('agenda: completar una tarea de Sanidad desde «Atención hoy»', async ({ page }) => {
  const u = uniqueUser('agtask');
  await registerAndAutoLogin(page, u);

  const cookies = await page.context().cookies();
  const token = cookies.find((c) => c.name === 'cw_access')?.value;
  const auth = { Authorization: `Bearer ${token}` };

  // Un animal (objetivo del plan → el dashboard operativo aparece con ≥1 animal).
  await page.request.post(`${API_URL}/animals`, { headers: auth, data: { tag: '900', sex: 'F', category_code: 'vaca' } });

  // Plan con un paso offset 0 (vencible hoy), aplicado a todas las categorías.
  const planRes = await page.request.post(`${API_URL}/health-plans`, {
    headers: auth,
    data: { name: 'Plan test', steps: [{ product_name: 'Chequeo', label: 'Revisión sanitaria', offset_days: 0, applies_to: [] }] },
  });
  const plan = await planRes.json();
  await page.request.post(`${API_URL}/health-plans/${plan.id}/apply`, { headers: auth, data: { anchor_date: new Date().toISOString().slice(0, 10) } });

  // Dashboard: «Atención hoy» muestra la tarea con «Completar».
  await page.goto('/');
  await expect(page.getByText('Atención hoy')).toBeVisible();
  await expect(page.getByText('Revisión sanitaria')).toBeVisible();

  // Completar desde la agenda → el ítem desaparece.
  await page.getByRole('button', { name: 'Completar' }).first().click();
  await expect(page.getByText('Revisión sanitaria')).toHaveCount(0);
});
