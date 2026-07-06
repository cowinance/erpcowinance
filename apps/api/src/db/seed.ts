import type { PGlite } from '@electric-sql/pglite';
import { hashPassword } from '../common/passwords';

/**
 * Seed de desarrollo: una organización demo con finca, hato, pesajes,
 * sanidad y reproducción — suficiente para dashboard, lista y ficha 360°.
 * Determinista (RNG con semilla) para que la demo sea reproducible.
 */

// RNG determinista (mulberry32)
function rng(seedNum: number) {
  let a = seedNum;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20260703);
const pick = <T>(arr: T[]) => arr[Math.floor(rand() * arr.length)];
const between = (min: number, max: number) => min + rand() * (max - min);
const daysAgo = (d: number) => new Date(Date.now() - d * 86400000);

export async function seed(db: PGlite) {
  const q = async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows as any[];

  // ── Catálogos globales ────────────────────────────────────────────────
  for (const [code, name, nameEn, auth] of [
    ['AR', 'Argentina', 'Argentina', 'SENASA'],
    ['UY', 'Uruguay', 'Uruguay', 'SNIG'],
    ['MX', 'México', 'Mexico', 'SINIIGA'],
    ['CO', 'Colombia', 'Colombia', 'ICA'],
    ['US', 'Estados Unidos', 'United States', 'USDA-ADT'],
    ['BR', 'Brasil', 'Brazil', 'SISBOV'],
  ])
    await q(`INSERT INTO countries (code, name, name_en, traceability_authority) VALUES ($1,$2,$3,$4)`, [code, name, nameEn, auth]);

  for (const [code, name, symbol] of [
    ['ARS', 'Peso argentino', '$'],
    ['UYU', 'Peso uruguayo', '$U'],
    ['MXN', 'Peso mexicano', '$'],
    ['COP', 'Peso colombiano', '$'],
    ['USD', 'Dólar estadounidense', 'US$'],
    ['BRL', 'Real brasileño', 'R$'],
  ])
    await q(`INSERT INTO currencies (code, name, symbol) VALUES ($1,$2,$3)`, [code, name, symbol]);

  for (const [code, name, dimension, factor] of [
    ['kg', 'Kilogramo', 'mass', 1],
    ['g', 'Gramo', 'mass', 0.001],
    ['lb', 'Libra', 'mass', 0.453592],
    ['t', 'Tonelada', 'mass', 1000],
    ['l', 'Litro', 'volume', 0.001],
    ['ml', 'Mililitro', 'volume', 0.000001],
    ['gal', 'Galón', 'volume', 0.003785],
    ['ha', 'Hectárea', 'area', 10000],
    ['m2', 'Metro cuadrado', 'area', 1],
    ['ac', 'Acre', 'area', 4046.86],
    ['km', 'Kilómetro', 'length', 1000],
    ['m', 'Metro', 'length', 1],
    ['c', 'Grado Celsius', 'temperature', 1],
    ['h', 'Hora', 'time', 3600],
    ['d', 'Día', 'time', 86400],
    ['un', 'Unidad', 'count', 1],
    ['mj', 'Megajulio', 'energy', 1000000],
  ])
    await q(`INSERT INTO units (code, name, dimension, si_factor) VALUES ($1,$2,$3,$4)`, [code, name, dimension, factor]);

  const [{ id: bovine }] = await q(
    `INSERT INTO species (code, name, gestation_days) VALUES ('bovine','Bovino',283) RETURNING id`,
  );
  await q(`INSERT INTO species (code, name, gestation_days) VALUES ('ovine','Ovino',150), ('equine','Equino',340), ('caprine','Caprino',150)`);

  const breedRows = await q(
    `INSERT INTO breeds (species_id, code, name, purpose) VALUES
     ($1,'angus','Angus','beef'), ($1,'hereford','Hereford','beef'),
     ($1,'brangus','Brangus','beef'), ($1,'braford','Braford','beef'),
     ($1,'holando','Holando Argentino','dairy') RETURNING id, code`,
    [bovine],
  );
  const breed = Object.fromEntries(breedRows.map((r) => [r.code, r.id]));

  const catRows = await q(
    `INSERT INTO animal_categories (species_id, code, name, sex, min_age_months) VALUES
     ($1,'vaca','Vaca','F',36), ($1,'toro','Toro','M',24),
     ($1,'novillo','Novillo','M',12), ($1,'vaquillona','Vaquillona','F',12),
     ($1,'ternero','Ternero','M',0), ($1,'ternera','Ternera','F',0) RETURNING id, code`,
    [bovine],
  );
  const cat = Object.fromEntries(catRows.map((r) => [r.code, r.id]));

  // ── Identidad y organización ──────────────────────────────────────────
  const [{ id: ownerRole }] = await q(
    `INSERT INTO roles (tenant_id, code, name, is_system) VALUES (NULL,'owner','Propietario',true) RETURNING id`,
  );
  await q(
    `INSERT INTO roles (tenant_id, code, name, is_system) VALUES
     (NULL,'admin','Administrador',true), (NULL,'veterinarian','Veterinario',true),
     (NULL,'foreman','Capataz',true), (NULL,'worker','Operario',true), (NULL,'accountant','Contador',true)`,
  );

  const [{ id: userId }] = await q(
    `INSERT INTO users (email, full_name, locale, password_hash) VALUES ('cowinance@gmail.com','Jose Montilla','es-AR',$1) RETURNING id`,
    [hashPassword('cowinance')],
  );
  const [{ id: org }] = await q(
    `INSERT INTO organizations (name, legal_name, country_code, default_currency, default_locale, timezone, created_by)
     VALUES ('Grupo La Esperanza','Grupo La Esperanza S.A.','AR','ARS','es-AR','America/Argentina/Buenos_Aires',$1) RETURNING id`,
    [userId],
  );
  // RLS: a partir de acá, las inserciones con tenant_id necesitan el GUC
  await q(`SELECT set_config('app.tenant_id', $1, false)`, [org]);
  await q(`INSERT INTO user_role_assignments (tenant_id, user_id, role_id) VALUES ($1,$2,$3)`, [org, userId, ownerRole]);
  const [{ id: company }] = await q(
    `INSERT INTO companies (tenant_id, name, tax_id, country_code, functional_currency, created_by)
     VALUES ($1,'La Esperanza S.A.','30-71234567-8','AR','ARS',$2) RETURNING id`,
    [org, userId],
  );
  const [{ id: farm }] = await q(
    `INSERT INTO farms (tenant_id, company_id, name, official_code, total_area_ha, timezone, created_by)
     VALUES ($1,$2,'Estancia La Esperanza','RENSPA 01.234.5.67890/01',850,'America/Argentina/Buenos_Aires',$3) RETURNING id`,
    [org, company, userId],
  );

  // ── Potreros y lotes ──────────────────────────────────────────────────
  // boundary: polígono esquemático (GeoJSON) en unidades de mapa local;
  // en producción es PostGIS geography con coordenadas reales (Fase 2: dibujo sobre tiles)
  const poly = (pts: number[][]) => JSON.stringify({ type: 'Polygon', coordinates: [pts] });
  const paddockDefs: [string, number, string, string][] = [
    ['Potrero Norte', 120, 'natural', poly([[25, 25], [390, 20], [405, 255], [35, 275]])],
    ['Potrero Laguna', 95, 'natural', poly([[410, 18], [975, 35], [952, 262], [422, 252]])],
    ['Pradera Alfalfa', 60, 'alfalfa', poly([[38, 292], [406, 272], [416, 452], [48, 468]])],
    ['Loma Sur', 140, 'natural', poly([[50, 485], [418, 468], [428, 578], [578, 572], [588, 672], [68, 680]])],
    ['Bajo Grande', 110, 'raigrás', poly([[425, 268], [952, 280], [936, 655], [598, 668], [588, 560], [432, 566]])],
    ['Corral Central', 8, 'feedlot', poly([[434, 470], [572, 462], [580, 552], [440, 558]])],
  ];
  const paddocks: string[] = [];
  for (const [name, area, pasture, boundary] of paddockDefs) {
    const [{ id }] = await q(
      `INSERT INTO paddocks (tenant_id, farm_id, name, boundary, area_ha, pasture_type, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [org, farm, name, boundary, area, pasture, userId],
    );
    paddocks.push(id);
  }

  const lotDefs: [string, string, string][] = [
    ['Rodeo Cría 1', 'breeding', paddocks[0]],
    ['Rodeo Cría 2', 'breeding', paddocks[3]],
    ['Recría 2026', 'weaning', paddocks[2]],
    ['Engorde Otoño', 'fattening', paddocks[5]],
  ];
  const lots: string[] = [];
  for (const [name, purpose, paddock] of lotDefs) {
    const [{ id }] = await q(
      `INSERT INTO lots (tenant_id, farm_id, name, purpose, current_paddock_id, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [org, farm, name, purpose, paddock, userId],
    );
    lots.push(id);
  }

  // ── Productos veterinarios ────────────────────────────────────────────
  const [{ id: prodAftosa }] = await q(
    `INSERT INTO products_veterinary (tenant_id, name, type, withdrawal_meat_days, default_dose)
     VALUES ($1,'Vacuna Aftosa','vaccine',0,'2 ml SC') RETURNING id`,
    [org],
  );
  const [{ id: prodIvermectina }] = await q(
    `INSERT INTO products_veterinary (tenant_id, name, type, active_ingredient, withdrawal_meat_days, default_dose)
     VALUES ($1,'Ivermectina 1%','antiparasitic','Ivermectina',35,'1 ml / 50 kg SC') RETURNING id`,
    [org],
  );
  const [{ id: prodOxitetra }] = await q(
    `INSERT INTO products_veterinary (tenant_id, name, type, active_ingredient, withdrawal_meat_days, withdrawal_milk_hours)
     VALUES ($1,'Oxitetraciclina LA','antibiotic','Oxitetraciclina',28,96) RETURNING id`,
    [org],
  );

  // ── Hato ──────────────────────────────────────────────────────────────
  type Def = { catCode: string; sex: 'F' | 'M'; n: number; ageMo: [number, number]; kg: [number, number]; lot: number };
  const defs: Def[] = [
    { catCode: 'vaca', sex: 'F', n: 18, ageMo: [40, 110], kg: [420, 520], lot: 0 },
    { catCode: 'vaca', sex: 'F', n: 10, ageMo: [40, 96], kg: [410, 500], lot: 1 },
    { catCode: 'toro', sex: 'M', n: 2, ageMo: [36, 84], kg: [700, 880], lot: 0 },
    { catCode: 'vaquillona', sex: 'F', n: 8, ageMo: [15, 26], kg: [280, 380], lot: 2 },
    { catCode: 'novillo', sex: 'M', n: 9, ageMo: [14, 24], kg: [300, 430], lot: 3 },
    { catCode: 'ternero', sex: 'M', n: 5, ageMo: [3, 9], kg: [90, 190], lot: 2 },
    { catCode: 'ternera', sex: 'F', n: 5, ageMo: [3, 9], kg: [85, 180], lot: 2 },
  ];

  const names = ['Estrella', 'Malinche', 'Paloma', 'Golondrina', 'Margarita', 'Fortuna', 'Serena', 'Yerbabuena', 'Centella', 'Amapola', 'Curiosa', 'Morocha', 'Overita', 'Zaina', 'Pampa'];
  const events: { animal: string; type: string; payload: Record<string, unknown>; at: Date }[] = [];
  let tag = 100;
  const animalIds: { id: string; sex: string; catCode: string; tag: string }[] = [];

  for (const d of defs) {
    for (let i = 0; i < d.n; i++) {
      const ageMonths = between(d.ageMo[0], d.ageMo[1]);
      const birth = daysAgo(ageMonths * 30.4);
      const breedCode = pick(['angus', 'angus', 'hereford', 'brangus', 'braford']);
      // Genealogía: los terneros nacen de una vaca y un toro del rodeo
      const isCalf = d.catCode === 'ternero' || d.catCode === 'ternera';
      const damId = isCalf ? pick(animalIds.filter((a) => a.catCode === 'vaca')).id : null;
      const sireId = isCalf ? pick(animalIds.filter((a) => a.catCode === 'toro')).id : null;
      const [{ id }] = await q(
        `INSERT INTO animals (tenant_id, farm_id, species_id, category_id, sex, name, birth_date, origin, dam_id, sire_id, current_lot_id, current_paddock_id, status, created_by, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'born',$8,$9,$10,$11,'active',$12,$13) RETURNING id`,
        [org, farm, bovine, cat[d.catCode], d.sex, d.catCode === 'vaca' && rand() < 0.5 ? pick(names) : null, birth.toISOString().slice(0, 10), damId, sireId, lots[d.lot], lotDefs[d.lot][2], userId, new Date(birth.getTime() + 3 * 86400000).toISOString()],
      );
      if (isCalf && damId) {
        const [{ id: calvingId }] = await q(
          `INSERT INTO calvings (tenant_id, dam_id, calving_date, ease, offspring_count, created_by)
           VALUES ($1,$2,$3,$4,1,$5) RETURNING id`,
          [org, damId, birth.toISOString().slice(0, 10), Math.floor(between(1, 3)), userId],
        );
        await q(
          `INSERT INTO calving_offspring (tenant_id, calving_id, animal_id, birth_weight_kg, vitality, created_by)
           VALUES ($1,$2,$3,$4,'live',$5)`,
          [org, calvingId, id, +between(28, 42).toFixed(1), userId],
        );
        events.push({ animal: damId, type: 'calving', payload: { offspring: 1 }, at: birth });
        // Destete a los ~7 meses para los que ya tienen la edad
        if (ageMonths >= 7) {
          const weanDate = new Date(birth.getTime() + 7 * 30.4 * 86400000);
          const weanKg = +between(150, 200).toFixed(0);
          await q(
            `INSERT INTO weanings (tenant_id, animal_id, weaning_date, weaning_weight_kg, dam_id, created_by)
             VALUES ($1,$2,$3,$4,$5,$6)`,
            [org, id, weanDate.toISOString().slice(0, 10), weanKg, damId, userId],
          );
          events.push({ animal: id, type: 'weaning', payload: { weight_kg: weanKg }, at: weanDate });
        }
      }
      tag += Math.floor(between(1, 9));
      const tagValue = String(tag);
      await q(
        `INSERT INTO animal_identifiers (tenant_id, animal_id, type, value, is_official, issued_at) VALUES ($1,$2,'visual',$3,false,$4)`,
        [org, id, tagValue, birth.toISOString().slice(0, 10)],
      );
      if (rand() < 0.6)
        await q(
          `INSERT INTO animal_identifiers (tenant_id, animal_id, type, value, is_official, issued_at) VALUES ($1,$2,'rfid',$3,true,$4)`,
          [org, id, '858 000' + String(100000000 + Math.floor(rand() * 899999999)), birth.toISOString().slice(0, 10)],
        );
      await q(`INSERT INTO animal_breeds (tenant_id, animal_id, breed_id) VALUES ($1,$2,$3)`, [org, id, breed[breedCode]]);
      events.push({ animal: id, type: 'birth', payload: { origin: 'born' }, at: birth });
      animalIds.push({ id, sex: d.sex, catCode: d.catCode, tag: tagValue });

      // Serie de pesajes: crecimiento hacia el peso actual con ruido
      const targetKg = between(d.kg[0], d.kg[1]);
      const nWeighings = 4 + Math.floor(rand() * 5);
      let prev: { kg: number; at: Date } | null = null;
      for (let w = 0; w < nWeighings; w++) {
        const frac = (w + 1) / nWeighings;
        const at = daysAgo((1 - frac) * Math.min(ageMonths * 30.4 * 0.7, 420) + between(0, 10));
        const kg = Math.round(targetKg * (0.45 + 0.55 * frac) + between(-8, 8));
        const adg = prev ? +(((kg - prev.kg) / Math.max(1, (at.getTime() - prev.at.getTime()) / 86400000)) as number).toFixed(3) : null;
        await q(
          `INSERT INTO weighings (tenant_id, animal_id, weighed_at, weight_kg, method, adg_since_last, body_condition, created_by)
           VALUES ($1,$2,$3,$4,'scale',$5,$6,$7)`,
          [org, id, at.toISOString(), kg, adg, +between(2.5, 4).toFixed(1), userId],
        );
        events.push({ animal: id, type: 'weighing', payload: { weight_kg: kg, adg_since_last: adg }, at });
        prev = { kg, at };
      }

      // Sanidad: vacuna aftosa a todos, antiparasitario a la mayoría
      const vacAt = daysAgo(between(20, 120));
      await q(
        `INSERT INTO vaccinations (tenant_id, animal_id, product_id, applied_at, dose, dose_unit, batch_number, next_due_date, created_by)
         VALUES ($1,$2,$3,$4,2,'ml',$5,$6,$7)`,
        [org, id, prodAftosa, vacAt.toISOString(), 'AF-2026-' + Math.floor(between(100, 999)), new Date(vacAt.getTime() + 180 * 86400000).toISOString().slice(0, 10), userId],
      );
      events.push({ animal: id, type: 'vaccination', payload: { product: 'Vacuna Aftosa', dose: '2 ml' }, at: vacAt });
      if (rand() < 0.7) {
        const tAt = daysAgo(between(10, 200));
        await q(
          `INSERT INTO treatments (tenant_id, animal_id, product_id, applied_at, dose, dose_unit, route, meat_withdrawal_until, cost, created_by)
           VALUES ($1,$2,$3,$4,$5,'ml','sc',$6,$7,$8)`,
          [org, id, prodIvermectina, tAt.toISOString(), +between(6, 12).toFixed(1), new Date(tAt.getTime() + 35 * 86400000).toISOString().slice(0, 10), +between(800, 1500).toFixed(2), userId],
        );
        events.push({ animal: id, type: 'treatment', payload: { product: 'Ivermectina 1%', withdrawal_days: 35 }, at: tAt });
      }
    }
  }

  // Un tratamiento con retiro ACTIVO (para la alerta del dashboard)
  const sick = animalIds.find((a) => a.catCode === 'novillo')!;
  const sickAt = daysAgo(5);
  await q(
    `INSERT INTO treatments (tenant_id, animal_id, product_id, applied_at, dose, dose_unit, route, meat_withdrawal_until, notes, created_by)
     VALUES ($1,$2,$3,$4,20,'ml','im',$5,'Cuadro respiratorio, seguimiento 48 h',$6)`,
    [org, sick.id, prodOxitetra, sickAt.toISOString(), new Date(sickAt.getTime() + 28 * 86400000).toISOString().slice(0, 10), userId],
  );
  events.push({ animal: sick.id, type: 'treatment', payload: { product: 'Oxitetraciclina LA', withdrawal_days: 28, note: 'retiro activo' }, at: sickAt });

  // ── Reproducción: ciclo completo celo → servicio → diagnóstico ────────
  const cows = animalIds.filter((a) => a.catCode === 'vaca');
  const bulls = animalIds.filter((a) => a.catCode === 'toro');
  let pregnant = 0;
  for (const cow of cows) {
    if (rand() < 0.65) {
      const diagAt = daysAgo(between(15, 120));
      const serviceAt = new Date(diagAt.getTime() - between(30, 45) * 86400000);
      const heatAt = new Date(serviceAt.getTime() - 21 * 86400000);
      const method = rand() < 0.5 ? 'service_ai' : 'service_natural';
      const sire = method === 'service_natural' ? pick(bulls).id : null;

      await q(
        `INSERT INTO breeding_events (tenant_id, animal_id, type, occurred_at, created_by) VALUES ($1,$2,'heat',$3,$4)`,
        [org, cow.id, heatAt.toISOString(), userId],
      );
      events.push({ animal: cow.id, type: 'heat', payload: {}, at: heatAt });

      const [{ id: serviceId }] = await q(
        `INSERT INTO breeding_events (tenant_id, animal_id, type, occurred_at, sire_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [org, cow.id, method, serviceAt.toISOString(), sire, userId],
      );
      events.push({ animal: cow.id, type: 'service', payload: { method: method === 'service_ai' ? 'ai' : 'natural' }, at: serviceAt });

      const due = new Date(serviceAt.getTime() + 283 * 86400000);
      await q(
        `INSERT INTO pregnancies (tenant_id, animal_id, breeding_event_id, diagnosis_date, method, expected_due_date, status, created_by)
         VALUES ($1,$2,$3,$4,'ultrasound',$5,'open',$6)`,
        [org, cow.id, serviceId, diagAt.toISOString().slice(0, 10), due.toISOString().slice(0, 10), userId],
      );
      events.push({ animal: cow.id, type: 'pregnancy_diagnosed', payload: { method: 'ultrasound', expected_due_date: due.toISOString().slice(0, 10) }, at: diagAt });
      pregnant++;
    }
  }

  // ── Escenario de alertas: eventos próximos y una preñez vencida ───────
  const soon = (d: number) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
  // 4 refuerzos de vacuna próximos (dispara "vacunación programada")
  const vaxSoon = await q(`SELECT id FROM vaccinations WHERE tenant_id = $1 ORDER BY applied_at LIMIT 4`, [org]);
  const vaxOffsets = [4, 9, 15, 22];
  for (let i = 0; i < vaxSoon.length; i++)
    await q(`UPDATE vaccinations SET next_due_date = $2 WHERE id = $1`, [vaxSoon[i].id, soon(vaxOffsets[i])]);
  // 3 partos próximos (dispara "parto próximo")
  const pregSoon = await q(`SELECT id FROM pregnancies WHERE tenant_id = $1 AND status = 'open' ORDER BY diagnosis_date LIMIT 3`, [org]);
  const pregOffsets = [6, 11, 14];
  for (let i = 0; i < pregSoon.length; i++)
    await q(`UPDATE pregnancies SET expected_due_date = $2 WHERE id = $1`, [pregSoon[i].id, soon(pregOffsets[i])]);
  // 1 preñez vencida sin parto registrado (dispara "preñez vencida")
  const pregOver = await q(`SELECT id FROM pregnancies WHERE tenant_id = $1 AND status = 'open' ORDER BY diagnosis_date DESC LIMIT 1`, [org]);
  if (pregOver[0]) await q(`UPDATE pregnancies SET expected_due_date = $2 WHERE id = $1`, [pregOver[0].id, soon(-6)]);

  // ── Mortalidad: una ternera muerta (para KPI y flujo de baja) ─────────
  const deadCalf = animalIds.find((a) => a.catCode === 'ternera')!;
  const diedAt = daysAgo(60);
  await q(
    `INSERT INTO mortalities (tenant_id, animal_id, died_at, necropsy, estimated_loss, notes, created_by)
     VALUES ($1,$2,$3,false,$4,'Diarrea neonatal',$5)`,
    [org, deadCalf.id, diedAt.toISOString(), 45000, userId],
  );
  await q(`UPDATE animals SET status = 'dead', status_changed_at = $2 WHERE id = $1`, [deadCalf.id, diedAt.toISOString()]);
  events.push({ animal: deadCalf.id, type: 'death', payload: { cause: 'Diarrea neonatal' }, at: diedAt });

  // ── Event store (línea de tiempo) ─────────────────────────────────────
  for (const e of events) {
    await q(
      `INSERT INTO animal_events (tenant_id, animal_id, event_type, payload, occurred_at, recorded_at, source, created_by)
       VALUES ($1,$2,$3,$4,$5,$5,'manual',$6)`,
      [org, e.animal, e.type, JSON.stringify(e.payload), e.at.toISOString(), userId],
    );
  }

  // ── Segundo tenant: prueba viviente del aislamiento RLS ───────────────
  const [{ id: mariaId }] = await q(
    `INSERT INTO users (email, full_name, locale, password_hash) VALUES ('maria@elombu.com','María Fernández','es-AR',$1) RETURNING id`,
    [hashPassword('ombu1234')],
  );
  const [{ id: orgB }] = await q(
    `INSERT INTO organizations (name, legal_name, country_code, default_currency, default_locale, timezone, created_by)
     VALUES ('Agropecuaria El Ombú','El Ombú S.R.L.','AR','ARS','es-AR','America/Argentina/Buenos_Aires',$1) RETURNING id`,
    [mariaId],
  );
  await q(`SELECT set_config('app.tenant_id', $1, false)`, [orgB]);
  await q(`INSERT INTO user_role_assignments (tenant_id, user_id, role_id) VALUES ($1,$2,$3)`, [orgB, mariaId, ownerRole]);
  const [{ id: companyB }] = await q(
    `INSERT INTO companies (tenant_id, name, country_code, functional_currency, created_by)
     VALUES ($1,'El Ombú S.R.L.','AR','ARS',$2) RETURNING id`,
    [orgB, mariaId],
  );
  const [{ id: farmB }] = await q(
    `INSERT INTO farms (tenant_id, company_id, name, total_area_ha, created_by) VALUES ($1,$2,'Campo El Ombú',320,$3) RETURNING id`,
    [orgB, companyB, mariaId],
  );
  for (let i = 0; i < 5; i++) {
    const birth = daysAgo(between(24, 60) * 30.4);
    const [{ id }] = await q(
      `INSERT INTO animals (tenant_id, farm_id, species_id, category_id, sex, birth_date, origin, status, created_by)
       VALUES ($1,$2,$3,$4,'F',$5,'born','active',$6) RETURNING id`,
      [orgB, farmB, bovine, cat['vaca'], birth.toISOString().slice(0, 10), mariaId],
    );
    await q(`INSERT INTO animal_identifiers (tenant_id, animal_id, type, value) VALUES ($1,$2,'visual',$3)`, [
      orgB,
      id,
      String(501 + i),
    ]);
  }
  // Restaurar el contexto del tenant principal para el resto del boot
  await q(`SELECT set_config('app.tenant_id', $1, false)`, [org]);

  console.log(
    `Seed: ${animalIds.length} animales (+5 de El Ombú), ${events.length} eventos, ${pregnant} preñeces. Usuarios: cowinance@gmail.com/cowinance · maria@elombu.com/ombu1234`,
  );
}
