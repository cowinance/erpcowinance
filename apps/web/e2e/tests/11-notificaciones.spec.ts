import { test, expect } from '@playwright/test';
import { uniqueUser, registerAndAutoLogin } from '../helpers';
import { API_URL } from '../env';

/**
 * E2E de notificaciones (P7-4.b), determinista (sin datos demo ni sleeps): siembra una alerta
 * animal-linked (retiro por tratamiento) para un tenant FRESCO; NO abre /notificaciones; navega
 * a una página normal → el layout consulta unread-count READ-THROUGH y muestra el badge; abre el
 * feed, marca leída, verifica deep-link a la ficha, el badge baja y el estado leído persiste.
 */
test('notificaciones: badge read-through, feed, marcar leída y deep-link', async ({ page }) => {
  const u = uniqueUser('notif');
  await registerAndAutoLogin(page, u);

  const cookies = await page.context().cookies();
  const token = cookies.find((c) => c.name === 'cw_access')?.value;
  const auth = { Authorization: `Bearer ${token}` };

  // Siembra por API: animal + producto con retiro + tratamiento → alerta withdrawal_active (animal).
  const animal = await (await page.request.post(`${API_URL}/animals`, { headers: auth, data: { tag: '500', sex: 'F', category_code: 'vaca' } })).json();
  const product = await (await page.request.post(`${API_URL}/products-veterinary`, { headers: auth, data: { name: 'Antibiótico X', type: 'other', withdrawal_meat_days: 30 } })).json();
  await page.request.post(`${API_URL}/treatments`, { headers: auth, data: { animal_id: animal.id, product_id: product.id } });

  // No abrir /notificaciones: navegar a una página normal → el layout crea el ledger y muestra el badge.
  await page.goto('/');
  await expect(page.getByLabel(/notificaciones no leídas/i)).toBeVisible();

  // Abrir el feed → ítem no leído.
  await page.goto('/notificaciones');
  await expect(page.getByRole('heading', { name: 'Notificaciones' })).toBeVisible();
  const unread = page.getByRole('button', { name: /No leída/i });
  await expect(unread.first()).toBeVisible();

  // Pulsar → marca leída (POST /read) y deep-link a la ficha del animal.
  await unread.first().click();
  await page.waitForURL(new RegExp(`/animales/${animal.id}`));

  // El badge desaparece (única notificación leída → count 0).
  await expect(page.getByLabel(/notificaciones no leídas/i)).toHaveCount(0);

  // Volver al feed → sin ítems no leídos.
  await page.goto('/notificaciones');
  await expect(page.getByRole('button', { name: /No leída/i })).toHaveCount(0);

  // Regresión: /alertas sigue funcionando.
  await page.goto('/alertas');
  await expect(page).toHaveURL(/\/alertas/);
});

test('notificaciones: tenant fresco sin condiciones → sin novedades', async ({ page }) => {
  const u = uniqueUser('notif-empty');
  await registerAndAutoLogin(page, u);
  // El dashboard operativo aparece con ≥1 animal, pero el feed vacío no lo requiere.
  await page.goto('/notificaciones');
  await expect(page.getByText(/sin novedades/i)).toBeVisible();
});
