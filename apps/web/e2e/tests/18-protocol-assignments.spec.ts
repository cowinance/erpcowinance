import { test, expect } from '@playwright/test';
import { uniqueUser, registerAndAutoLogin } from '../helpers';
import { API_URL } from '../env';

/**
 * E2E web de asignación de protocolos + calendario previsto (R-2.b.2). Fecha de inicio FIJA en el
 * futuro (2030) para independizar el calendario de la fecha del sistema. Cubre asignar → feedback →
 * asignación activa → pasos en fechas correctas y orden → cancelar → desaparece de activas y del
 * calendario → plantillas siguen visibles. Un 2.º test cubre los estados vacíos de un tenant fresco.
 */
async function seedTemplateAndLot(page: any, auth: any) {
  await page.request.post(`${API_URL}/reproduction/protocols`, { headers: auth, data: { name: 'IATF E2E', steps: [{ day: 0, action: 'Implante' }, { day: 8, action: 'Retiro' }] } });
  const lot = await (await page.request.post(`${API_URL}/lots`, { headers: auth, data: { name: 'Lote E2E' } })).json();
  await page.request.post(`${API_URL}/animals`, { headers: auth, data: { tag: 'PV1', sex: 'F', category_code: 'vaca', lot_id: lot.id } });
}

test('protocolos: asignar, calendario previsto y cancelar', async ({ page }) => {
  const u = uniqueUser('assign');
  await registerAndAutoLogin(page, u);
  const auth = { Authorization: `Bearer ${(await page.context().cookies()).find((c) => c.name === 'cw_access')?.value}` };
  await seedTemplateAndLot(page, auth);

  await page.goto('/reproduccion/protocolos');
  await expect(page.getByRole('heading', { name: 'Protocolos reproductivos' })).toBeVisible();

  // Asignar (fecha futura fija).
  await page.getByLabel('Protocolo a asignar').selectOption({ label: 'IATF E2E' });
  await page.getByLabel('Lote destino').selectOption({ label: 'Lote E2E' });
  await page.getByLabel('Fecha de inicio').fill('2030-05-01');
  await page.getByRole('button', { name: 'Asignar protocolo' }).click();

  // Feedback con número de tareas.
  await expect(page.getByText(/2 tareas generadas/)).toBeVisible();
  // Asignación activa (botón de cancelar con nombre accesible).
  await expect(page.getByRole('button', { name: /Cancelar asignación de IATF E2E al lote Lote E2E/ })).toBeVisible();
  // Calendario previsto: pasos en fechas correctas y orden (Implante 1/5, Retiro 9/5).
  await expect(page.locator('time[datetime="2030-05-01"]')).toBeVisible();
  await expect(page.locator('time[datetime="2030-05-09"]')).toBeVisible();
  await expect(page.getByText('Implante', { exact: true })).toBeVisible();
  await expect(page.getByText('Retiro', { exact: true })).toBeVisible();

  // Cancelar (confirmación).
  await page.getByRole('button', { name: /Cancelar asignación de IATF E2E/ }).click();
  await page.getByRole('button', { name: /Confirmar cancelación de IATF E2E/ }).click();

  // Desaparece de activas y del calendario; la plantilla sigue.
  await expect(page.getByText('Sin asignaciones activas')).toBeVisible();
  await expect(page.getByText('Sin próximos pasos programados')).toBeVisible();
  await expect(page.getByText('Día 0: Implante')).toBeVisible(); // la plantilla sigue intacta
});

test('protocolos: tenant fresco muestra estados vacíos correctos', async ({ page }) => {
  const u = uniqueUser('assign-empty');
  await registerAndAutoLogin(page, u);
  await page.goto('/reproduccion/protocolos');
  await expect(page.getByText('Sin protocolos todavía. Creá el primero →')).toBeVisible();
  await expect(page.getByText('Creá una plantilla de protocolo para poder asignar.')).toBeVisible();
  await expect(page.getByText('Sin asignaciones activas')).toBeVisible();
  await expect(page.getByText('Sin próximos pasos programados')).toBeVisible();
});
