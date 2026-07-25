import { test, expect } from '@playwright/test';
import { uniqueUser, registerAndAutoLogin } from '../helpers';
import { API_URL } from '../env';

/**
 * Plan de servicio por animal (GT-3).
 *
 * Lo que prueba este recorrido y no puede probar un test unitario: que la pantalla y el stock estén
 * de acuerdo. Reservar una pajuela tiene que SACARLA del disponible, y descartar el vientre en la
 * revisión tiene que devolverla — sin que nadie se acuerde de hacerlo.
 */
test('la campaña reserva la pajuela por vientre y la suelta al descartarlo', async ({ page }) => {
  const u = uniqueUser('plan');
  await registerAndAutoLogin(page, u);
  const token = (await page.context().cookies()).find((c) => c.name === 'cw_access')?.value;
  const auth = { Authorization: `Bearer ${token}` };

  // Dos vientres, para que la campaña tenga a quién planificar.
  for (const tag of ['PLAN-1', 'PLAN-2'])
    await page.request.post(`${API_URL}/animals`, { headers: auth, data: { tag, sex: 'F', category_code: 'vaca' } });

  // Termo con una posición y una partida de 2 pajuelas ubicadas.
  const termo = await (await page.request.post(`${API_URL}/genetics/cryo/tanks`, { headers: auth, data: { code: '207' } })).json();
  const canasta = await (
    await page.request.post(`${API_URL}/genetics/cryo/tanks/${termo.id}/canisters`, { headers: auth, data: { code: '2', color: 'azul' } })
  ).json();
  const gobelete = await (
    await page.request.post(`${API_URL}/genetics/cryo/canisters/${canasta.id}/goblets`, { headers: auth, data: { code: '5' } })
  ).json();
  const lote = await (
    await page.request.post(`${API_URL}/genetics/semen`, { headers: auth, data: { batch_code: 'SANSAO', sire_name_external: 'Sansão', straws_available: 2 } })
  ).json();
  const unidades = await (await page.request.get(`${API_URL}/genetics/straws?semen_batch_id=${lote.id}`, { headers: auth })).json();
  await page.request.post(`${API_URL}/genetics/straws/move`, {
    headers: auth,
    data: { ids: unidades.map((s: any) => s.id), goblet_id: gobelete.id },
  });

  // La campaña: un protocolo con su paso de inseminación, asignado a todo el hato.
  const protocolo = await (
    await page.request.post(`${API_URL}/reproduction/protocols`, {
      headers: auth,
      data: { name: 'IATF e2e', steps: [{ day: 10, action: 'IATF', kind: 'insemination' }] },
    })
  ).json();
  await page.request.post(`${API_URL}/reproduction/protocol-assignments`, {
    headers: auth,
    data: { protocol_id: protocolo.id, start_date: new Date().toISOString().slice(0, 10) },
  });

  await page.goto('/reproduccion/campanas');
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('cell', { name: 'PLAN-1' })).toBeVisible();

  // Planificar: elegir el origen y la pajuela concreta.
  await page.getByLabel('Origen para PLAN-1').selectOption({ index: 1 });
  await page.getByLabel('Pajuela para PLAN-1').selectOption({ index: 1 });
  await page.getByRole('row', { name: /PLAN-1/ }).getByRole('button', { name: 'Asignar' }).click();

  // Se espera a algo que SOLO existe con el plan ya guardado. La posición no sirve de señal: el
  // texto también está en los `<option>` de los selectores, así que una aserción sobre él pasaría
  // antes de que el POST termine y el saldo se leería demasiado pronto.
  await expect(page.getByRole('row', { name: /PLAN-1/ }).getByRole('button', { name: 'Sacar del plan' })).toBeVisible({
    timeout: 20_000,
  });

  // Y la lista de retiro nombra la posición con la MISMA regla del dominio que la fila del vientre:
  // si divergieran, quien está frente al termo no sabría si son la misma posición.
  await expect(page.getByRole('listitem').filter({ hasText: '207 · azul 2 · gob. 5' })).toBeVisible();

  // Y el stock lo refleja: la reservada dejó de estar libre.
  const conReserva = await (await page.request.get(`${API_URL}/genetics/semen/${lote.id}`, { headers: auth })).json();
  expect(conReserva).toMatchObject({ straws_available: 1, straws_reserved: 1 });

  // La revisión la descarta → la pajuela vuelve sola, sin que nadie se acuerde de soltarla.
  await page.getByLabel('Revisión de PLAN-1').selectOption('not_eligible');
  await expect(page.getByRole('row', { name: /PLAN-1/ }).getByText('queda fuera de la jornada')).toBeVisible({ timeout: 20_000 });

  const liberada = await (await page.request.get(`${API_URL}/genetics/semen/${lote.id}`, { headers: auth })).json();
  expect(liberada).toMatchObject({ straws_available: 2, straws_reserved: 0 });

  /**
   * GT-3b: la campaña no termina al inseminar. Se sirve a PLAN-2 y se comprueba que el resultado
   * aparezca recién con el diagnóstico — y que hasta entonces la preñez se muestre como «—» y no
   * como 0 %, que diría algo distinto y falso sobre el toro.
   */
  await page.getByLabel('Origen para PLAN-2').selectOption({ index: 1 });
  await page.getByLabel('Pajuela para PLAN-2').selectOption({ index: 1 });
  await page.getByRole('row', { name: /PLAN-2/ }).getByRole('button', { name: 'Asignar' }).click();
  await expect(page.getByRole('row', { name: /PLAN-2/ }).getByRole('button', { name: 'Sacar del plan' })).toBeVisible({
    timeout: 20_000,
  });

  const animales = await (await page.request.get(`${API_URL}/animals?status=active`, { headers: auth })).json();
  const plan2 = (animales.data ?? animales).find((a: any) => a.tag === 'PLAN-2');
  await page.request.post(`${API_URL}/reproduction/protocol-assignments/${(await (await page.request.get(`${API_URL}/reproduction/protocol-assignments`, { headers: auth })).json()).find((a: any) => a.status === 'active').id}/steps/0/complete`, {
    headers: auth,
    data: {},
  });

  await page.reload();
  await expect(page.getByText('Resultado de la campaña')).toBeVisible();
  // Servida pero sin ecografiar: la preñez todavía no se puede afirmar.
  await expect(page.getByRole('row', { name: /^Sansão/ }).getByText('—')).toBeVisible();

  await page.request.post(`${API_URL}/pregnancy-diagnoses`, { headers: auth, data: { animal_id: plan2.id, result: 'pregnant' } });
  await page.reload();
  await expect(page.getByRole('row', { name: /^Sansão/ }).getByText('100%')).toBeVisible();
});
