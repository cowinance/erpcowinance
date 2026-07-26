import type { TxHandle } from './driver';
import { hashPassword } from '../common/passwords';

/** Lo único que el seed necesita de la base: correr consultas. Así sirve tanto sobre PGlite (dev)
 *  como sobre PostgreSQL real, sin acoplarse a un driver concreto. */
type Queryable = TxHandle;

/**
 * Seed de desarrollo, dividido en dos responsabilidades independientes (P1.1):
 *
 * - `bootstrapCatalogs(db)`: catálogos base y roles de sistema que TODA finca
 *   necesita (países, monedas, unidades, especies, razas, categorías, roles).
 *   Idempotente y siempre ejecutado — una finca que se registra self-service
 *   depende de que estos existan (p. ej. el rol `owner`).
 * - `seedDemo(db)`: la organización demo "Grupo La Esperanza" + "El Ombú" con
 *   hato, pesajes, sanidad y reproducción. Solo se ejecuta bajo el flag
 *   `SEED_DEMO` (ON en dev, OFF en producción). Sin datos demo, el sistema
 *   arranca vacío y espera el registro real.
 *
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

/**
 * Catálogos globales + roles de sistema. Idempotente: si ya se cargaron
 * (hay países), no hace nada. Se ejecuta SIEMPRE en el arranque — el registro
 * self-service de una finca nueva depende de que el rol `owner` exista.
 */
export async function bootstrapCatalogs(db: Queryable) {
  const q = async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows as any[];

  const [{ n }] = await q(`SELECT count(*)::int AS n FROM countries`);
  if (n > 0) return; // ya inicializado

  // ── Catálogos globales ────────────────────────────────────────────────
  for (const [code, name, nameEn, auth] of [
    ['VE', 'Venezuela', 'Venezuela', 'INSAI'],
    ['AR', 'Argentina', 'Argentina', 'SENASA'],
    ['UY', 'Uruguay', 'Uruguay', 'SNIG'],
    ['MX', 'México', 'Mexico', 'SINIIGA'],
    ['CO', 'Colombia', 'Colombia', 'ICA'],
    ['US', 'Estados Unidos', 'United States', 'USDA-ADT'],
    ['BR', 'Brasil', 'Brazil', 'SISBOV'],
  ])
    await q(`INSERT INTO countries (code, name, name_en, traceability_authority) VALUES ($1,$2,$3,$4)`, [code, name, nameEn, auth]);

  for (const [code, name, symbol] of [
    ['VES', 'Bolívar', 'Bs.'],
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

  await q(
    `INSERT INTO breeds (species_id, code, name, purpose) VALUES
     ($1,'angus','Angus','beef'), ($1,'hereford','Hereford','beef'),
     ($1,'brangus','Brangus','beef'), ($1,'braford','Braford','beef'),
     ($1,'holando','Holando Argentino','dairy')`,
    [bovine],
  );

  await q(
    `INSERT INTO animal_categories (species_id, code, name, sex, min_age_months) VALUES
     ($1,'vaca','Vaca','F',36), ($1,'toro','Toro','M',24),
     ($1,'novillo','Novillo','M',12), ($1,'vaquillona','Vaquillona','F',12),
     ($1,'ternero','Ternero','M',0), ($1,'ternera','Ternera','F',0)`,
    [bovine],
  );

  // ── Diagnósticos base (tenant_id NULL: catálogo global; cada finca puede extenderlo) ──
  // Se marcan como notificables las de denuncia obligatoria en Argentina (SENASA).
  await q(
    `INSERT INTO diagnoses (tenant_id, code, name, category, is_notifiable) VALUES
     (NULL,'neumonia','Neumonía','respiratoria',false),
     (NULL,'diarrea_neonatal','Diarrea neonatal','digestiva',false),
     (NULL,'timpanismo','Timpanismo','digestiva',false),
     (NULL,'mastitis','Mastitis','mamaria',false),
     (NULL,'queratoconjuntivitis','Queratoconjuntivitis','ocular',false),
     (NULL,'pietin','Pietín','podal',false),
     (NULL,'carbunclo','Carbunclo bacteridiano','infecciosa',true),
     (NULL,'brucelosis','Brucelosis','reproductiva',true),
     (NULL,'tuberculosis','Tuberculosis bovina','infecciosa',true),
     (NULL,'fiebre_aftosa','Fiebre aftosa','viral',true),
     (NULL,'parasitosis','Parasitosis gastrointestinal','parasitaria',false),
     (NULL,'intoxicacion','Intoxicación','toxica',false)
     ON CONFLICT (tenant_id, code) DO NOTHING`,
  );

  // ── Roles de sistema (tenant_id NULL): base de RBAC para toda finca ────
  await q(
    `INSERT INTO roles (tenant_id, code, name, is_system) VALUES
     (NULL,'owner','Propietario',true), (NULL,'admin','Administrador',true),
     (NULL,'veterinarian','Veterinario',true), (NULL,'foreman','Capataz',true),
     (NULL,'worker','Operario',true), (NULL,'accountant','Contador',true)`,
  );

  // ── Planes SaaS (catálogo global; precios en USD, límites por plan) ─────
  await q(
    `INSERT INTO plans (code, name, monthly_price_usd, max_animals, max_users, max_devices) VALUES
     ('trial','Prueba',0,1000,5,5),
     ('basico','Básico',29,500,3,3),
     ('pro','Pro',79,5000,10,10)
     ON CONFLICT (code) DO NOTHING`,
  );
}

/**
 * Datos demo (organización "Grupo La Esperanza" + "El Ombú"). Depende de que
 * `bootstrapCatalogs` ya haya corrido; resuelve por lookup las entidades base
 * que necesita (especie bovina, razas, categorías, rol owner) en vez de
 * recibirlas — así queda desacoplado del bootstrap. Solo corre bajo `SEED_DEMO`.
 */
export async function seedDemo(db: Queryable) {
  const q = async (sql: string, params?: unknown[]) => (await db.query(sql, params)).rows as any[];

  // Entidades base creadas por bootstrapCatalogs
  const [{ id: bovine }] = await q(`SELECT id FROM species WHERE code = 'bovine'`);
  const breedRows = await q(`SELECT id, code FROM breeds WHERE species_id = $1`, [bovine]);
  const breed = Object.fromEntries(breedRows.map((r) => [r.code, r.id]));
  const catRows = await q(`SELECT id, code FROM animal_categories WHERE species_id = $1`, [bovine]);
  const cat = Object.fromEntries(catRows.map((r) => [r.code, r.id]));
  const [{ id: ownerRole }] = await q(`SELECT id FROM roles WHERE code = 'owner' AND tenant_id IS NULL`);

  // ── Identidad y organización ──────────────────────────────────────────
  const [{ id: userId }] = await q(
    `INSERT INTO users (email, full_name, locale, password_hash) VALUES ('cowinance@gmail.com','Jose Montilla','es-AR',$1) RETURNING id`,
    [await hashPassword('cowinance')],
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
    // Sanidad E6: lotes de internación (vacíos), para enviar animales a hospital/cuarentena.
    ['Hospital', 'hospital', paddocks[1]],
    ['Cuarentena', 'quarantine', paddocks[4]],
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
    // TRES toros y no dos: con dos, el índice por toro es una comparación de a pares y no se ve
    // que 100 es el promedio del GRUPO. Con tres, la demo enseña a leerlo.
    { catCode: 'toro', sex: 'M', n: 3, ageMo: [36, 84], kg: [700, 880], lot: 0 },
    { catCode: 'vaquillona', sex: 'F', n: 8, ageMo: [15, 26], kg: [280, 380], lot: 2 },
    { catCode: 'novillo', sex: 'M', n: 9, ageMo: [14, 24], kg: [300, 430], lot: 3 },
    // Terneros de 7 a 11 meses: a esa edad YA ESTÁN DESTETADOS, que es lo que hace posible evaluar
    // genética. Antes eran de 3 a 9 y solo dos llegaban al destete, así que la evaluación por toro
    // se veía vacía aunque el cálculo estuviera bien.
    { catCode: 'ternero', sex: 'M', n: 9, ageMo: [7, 11], kg: [140, 210], lot: 2 },
    { catCode: 'ternera', sex: 'F', n: 9, ageMo: [7, 11], kg: [130, 195], lot: 2 },
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
      // El NOVILLO también lleva padre, aunque sin parto registrado: nació antes de que la finca
      // usara el sistema. Sin esto no habría con qué evaluar la genética contra la faena, que es
      // el último escalón de la cadena — y el que dice qué toro da mejores carcasas.
      const conocePadre = isCalf || d.catCode === 'novillo';
      const damId = isCalf ? pick(animalIds.filter((a) => a.catCode === 'vaca')).id : null;
      const sireId = conocePadre ? pick(animalIds.filter((a) => a.catCode === 'toro')).id : null;
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
          // El peso al destete DEPENDE DEL PADRE, con ruido encima. Si fuera puro azar, el índice
          // por toro compararía ruido y la demo enseñaría a confiar en un número sin señal — que es
          // justo lo contrario de lo que este módulo intenta.
          const toros = animalIds.filter((a) => a.catCode === 'toro').map((a) => a.id);
          const efectoPadre = sireId ? [18, 0, -14][toros.indexOf(sireId) % 3] : 0;
          const weanKg = +Math.max(120, between(160, 195) + efectoPadre).toFixed(0);
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
      for (let w = 0; w < nWeighings; w++) {
        const frac = (w + 1) / nWeighings;
        const at = daysAgo((1 - frac) * Math.min(ageMonths * 30.4 * 0.7, 420) + between(0, 10));
        const kg = Math.round(targetKg * (0.45 + 0.55 * frac) + between(-8, 8));
        await q(
          `INSERT INTO weighings (tenant_id, animal_id, weighed_at, weight_kg, method, body_condition, created_by)
           VALUES ($1,$2,$3,$4,'scale',$5,$6)`,
          [org, id, at.toISOString(), kg, +between(2.5, 4).toFixed(1), userId],
        );
        events.push({ animal: id, type: 'weighing', payload: { weight_kg: kg }, at });
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
  // La FERTILIDAD DEPENDE DEL TORO, y no es la misma que su peso al destete.
  //
  // Antes el seed solo cargaba los servicios que habían preñado: las vacas vacías no tenían
  // servicio, así que todos los toros daban 100% de concepción. Con eso, el costo por kilo
  // destetado quedaba proporcional al precio de la pajuela y la pantalla enseñaba justo lo
  // contrario de lo que existe para enseñar. Un servicio que no preñó ES un dato — es la mitad de
  // la cuenta de cuántas dosis hace falta por ternero.
  //
  // Los valores se eligen para que el ranking por costo salga INVERTIDO al ranking por índice: el
  // toro más caro es el mejor al destete (índice 109) y el más caro por kilo destetado. La pantalla
  // muestra las dos columnas juntas justamente para que esa tensión se vea y la decida el productor.
  const fertilidad = [0.85, 0.4, 0.7];
  const fertilidadDe = (sireId: string) => fertilidad[Math.max(0, bulls.findIndex((b) => b.id === sireId)) % fertilidad.length];
  let pregnant = 0;
  for (const cow of cows) {
    // Casi todo el rodeo entra al servicio; las que quedan afuera son las de parto reciente.
    if (rand() >= 0.9) continue;
    const diagAt = daysAgo(between(15, 120));
    const serviceAt = new Date(diagAt.getTime() - between(30, 45) * 86400000);
    const heatAt = new Date(serviceAt.getTime() - 21 * 86400000);
    const method = rand() < 0.5 ? 'service_ai' : 'service_natural';
    // La INSEMINACIÓN también lleva toro. Antes iba en null y la tasa de concepción por toro solo
    // veía el servicio natural; sin esto tampoco hay a quién imputarle el costo de la pajuela.
    const sire = pick(bulls).id;

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

    // El servicio que no preñó queda cargado igual, sin preñez. Es lo que pasa en la finca.
    if (rand() >= fertilidadDe(sire)) continue;

    const due = new Date(serviceAt.getTime() + 283 * 86400000);
    await q(
      `INSERT INTO pregnancies (tenant_id, animal_id, breeding_event_id, diagnosis_date, method, expected_due_date, status, created_by)
       VALUES ($1,$2,$3,$4,'ultrasound',$5,'open',$6)`,
      [org, cow.id, serviceId, diagAt.toISOString().slice(0, 10), due.toISOString().slice(0, 10), userId],
    );
    events.push({ animal: cow.id, type: 'pregnancy_diagnosed', payload: { method: 'ultrasound', expected_due_date: due.toISOString().slice(0, 10) }, at: diagAt });
    pregnant++;
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

  // ── Planes sanitarios reutilizables (calendarios) ─────────────────────
  const planGeneral = [
    { product_id: prodAftosa, product_name: 'Vacuna Aftosa', applies_to: [], offset_days: 0, label: 'Vacunación Aftosa' },
    { product_id: prodAftosa, product_name: 'Vacuna Aftosa', applies_to: [], offset_days: 180, label: 'Refuerzo Aftosa' },
    { product_id: prodIvermectina, product_name: 'Ivermectina 1%', applies_to: [], offset_days: 0, label: 'Desparasitación' },
    { product_id: prodIvermectina, product_name: 'Ivermectina 1%', applies_to: [], offset_days: 90, label: 'Desparasitación (2ª dosis)' },
  ];
  const planRecria = [
    { product_id: prodIvermectina, product_name: 'Ivermectina 1%', applies_to: ['ternero', 'ternera'], offset_days: 7, label: 'Desparasitación de destete' },
    { product_id: prodAftosa, product_name: 'Vacuna Aftosa', applies_to: ['ternero', 'ternera'], offset_days: 14, label: 'Primovacunación Aftosa' },
  ];
  await q(
    `INSERT INTO health_plans (tenant_id, name, species_id, schedule, created_by) VALUES ($1,'Plan sanitario general',$2,$3,$4)`,
    [org, bovine, JSON.stringify(planGeneral), userId],
  );
  await q(
    `INSERT INTO health_plans (tenant_id, name, species_id, schedule, created_by) VALUES ($1,'Plan de recría',$2,$3,$4)`,
    [org, bovine, JSON.stringify(planRecria), userId],
  );

  // Aplicar el plan de recría al lote de recría (tareas próximas → recordatorios)
  const recriaLot = lots[2];
  const anchorTasks = new Date(); // ancla hoy → tareas próximas (días 7 y 14), no vencidas
  const targetAnimals = await q(
    `SELECT a.id, c.code AS category_code, ai.value AS tag FROM animals a
     LEFT JOIN animal_categories c ON c.id = a.category_id
     LEFT JOIN LATERAL (SELECT value FROM animal_identifiers x WHERE x.animal_id = a.id AND x.type='visual' ORDER BY x.created_at DESC LIMIT 1) ai ON true
     WHERE a.tenant_id = $1 AND a.current_lot_id = $2 AND a.status = 'active' AND a.deleted_at IS NULL`,
    [org, recriaLot],
  );
  for (const animal of targetAnimals) {
    for (const step of planRecria) {
      if (step.applies_to.length && !step.applies_to.includes(animal.category_code)) continue;
      const due = new Date(anchorTasks.getTime() + step.offset_days * 86400000);
      await q(
        // `batch_key` igual que en la materialización real del plan: sin esto los datos demo no se
        // parecerían a los de producción y el agrupado de alertas se vería «roto» solo en la demo.
        `INSERT INTO tasks (tenant_id, farm_id, title, type, due_date, priority, status, related_type, related_id, created_by, batch_key, batch_label)
         VALUES ($1,$2,$3,'health',$4,'normal','pending','animal',$5,$6,$7,$8)`,
        [
          org,
          farm,
          `${step.label} — caravana ${animal.tag ?? '—'}`,
          due.toISOString(),
          animal.id,
          userId,
          `plan:demo:${step.label}:${due.toISOString().slice(0, 10)}`,
          step.label,
        ],
      );
    }
  }

  // ── Partidas de semen: el costo de la genética ────────────────────────────────────────
  // Sin precio de pajuela, la evaluación por toro contesta «cuál rinde más» pero no «cuál CONVIENE».
  // Un toro 8% mejor al destete que cuesta el triple por dosis puede ser el peor negocio.
  //
  // Los precios difieren entre toros a propósito, y el más caro NO es el mejor: si el ranking por
  // desempeño y el ranking por costo coincidieran, la pantalla no enseñaría nada.
  {
    const torosSemen = animalIds.filter((a) => a.catCode === 'toro');
    const precios = [42, 18, 9]; // el mejor al destete es también el más caro
    for (let i = 0; i < torosSemen.length; i++) {
      const [{ id: partida }] = await q(
        `INSERT INTO semen_batches (tenant_id, sire_id, batch_code, acquired_date, unit_cost, created_by)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [org, torosSemen[i].id, `LOTE-${2025}-${i + 1}`, daysAgo(between(200, 400)).toISOString().slice(0, 10), precios[i % 3], userId],
      );
      // El saldo es DERIVADO desde GT-2: son filas de pajuela, no un contador en la partida.
      // Sembrar el contador dejaría la partida con stock cero en la pantalla de criogenia.
      await q(
        `INSERT INTO cryo_straws (tenant_id, kind, semen_batch_id, status, notes)
         SELECT $1, 'semen', $2, 'stored', 'Sin ubicar en el termo.' FROM generate_series(1, $3)`,
        [org, partida, Math.round(between(20, 60))],
      );
    }
  }

  // ── Trazabilidad y una venta de hacienda (Fase 3.3) ──────────────────────────────────
  //
  // El aviso de certificación solo se puede ver si hay algo contra qué contrastar. Se siembran los
  // TRES estados que cambian la conclusión, porque cada uno se resuelve en un lugar distinto:
  //
  //   - Vigente a nivel FINCA → cubre a todos, no hay nada que avisar.
  //   - VENCIDA a nivel finca → hay que renovarla antes de despachar.
  //   - Vigente a nivel LOTE → cubre solo a ese lote: una venta que mezcla lotes sale «parcial»,
  //     que es el caso que más caro se paga y el más difícil de ver a ojo.
  //
  // La venta queda en `draft` a propósito: el aviso existe para leerse ANTES de cerrarla.
  {
    const [{ id: socioExportador }] = await q(
      `INSERT INTO business_partners (tenant_id, company_id, type, name, tax_id) VALUES ($1,$2,'customer','Exportadora del Llano','J-30158742-6') RETURNING id`,
      [org, company],
    );
    await q(`INSERT INTO customers (tenant_id, partner_id, segment) VALUES ($1,$2,'export')`, [org, socioExportador]);

    const hoy = new Date().toISOString().slice(0, 10);
    const enDias = (d: number) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);
    await q(
      `INSERT INTO certifications (tenant_id, entity_type, entity_id, scheme, issuer, valid_from, valid_until, status, created_by) VALUES
         ($1,'farm',$2,'Predio libre de brucelosis','INSAI',$3,$4,'active',$5),
         ($1,'farm',$2,'Buenas Prácticas Ganaderas','INSAI',$3,$6,'active',$5),
         ($1,'lot',$7,'Carne Natural Certificada','Programa Carne Natural',$3,$8,'active',$5)`,
      [org, farm, daysAgo(500).toISOString().slice(0, 10), enDias(400), userId, daysAgo(40).toISOString().slice(0, 10), lots[3], enDias(300)],
    );

    // La venta mezcla animales del lote certificado con otros que no lo están: es el escenario que
    // la pantalla tiene que poder mostrar, y el que a ojo no se ve.
    const delLoteCertificado = await q(`SELECT id FROM animals WHERE tenant_id=$1 AND current_lot_id=$2 AND status='active' AND deleted_at IS NULL LIMIT 3`, [org, lots[3]]);
    const deOtroLote = await q(`SELECT id FROM animals WHERE tenant_id=$1 AND current_lot_id=$2 AND status='active' AND deleted_at IS NULL LIMIT 2`, [org, lots[2]]);
    const aVender = [...delLoteCertificado, ...deOtroLote];
    if (aVender.length > 0) {
      const [{ id: venta }] = await q(
        `INSERT INTO sales (tenant_id, company_id, customer_partner_id, document_number, sale_date, type, currency, subtotal, tax_total, total, status, created_by)
         VALUES ($1,$2,$3,'VTA-2026-0044',$4,'livestock','USD',0,0,0,'draft',$5) RETURNING id`,
        [org, company, socioExportador, hoy, userId],
      );
      let subtotal = 0;
      for (const a of aVender) {
        const kg = Math.round(between(380, 460));
        const precio = +(between(2.6, 3.1) * kg).toFixed(2);
        subtotal += precio;
        await q(
          `INSERT INTO sale_lines (tenant_id, sale_id, animal_id, description, quantity, unit_price, weight_kg, tax_rate, line_total, created_by)
           VALUES ($1,$2,$3,'Novillo gordo',1,$4,$5,0,$4,$6)`,
          [org, venta, a.id, precio, kg, userId],
        );
      }
      await q(`UPDATE sales SET subtotal=$2, total=$2 WHERE id=$1`, [venta, subtotal.toFixed(2)]);
    }
  }

  // ── Clima: estación meteorológica con una SECA deliberada (Fase 3.2) ─────────────────
  //
  // Sin serie climática, el rendimiento del potrero es una tabla de kg/ha sin contexto, que es
  // exactamente la lectura que la etapa viene a evitar: sacar de la rotación un potrero que rindió
  // poco porque le tocó la seca.
  //
  // Por eso la serie NO es ruido uniforme. Hay un tramo seco de verdad, y las rotaciones se
  // acomodan para que un potrero caiga dentro de él: solo así la pantalla puede enseñar la
  // diferencia entre un potrero malo y un potrero con mala suerte.
  const SECA_DESDE = 150; // días atrás
  const SECA_HASTA = 90;
  {
    const [{ id: tipoEstacion }] = await q(
      `INSERT INTO device_types (code, name, category, protocol) VALUES ('weather_station','Estación meteorológica','environmental','lorawan')
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
    );
    const [{ id: estacion }] = await q(
      `INSERT INTO devices (tenant_id, farm_id, device_type_id, serial_number, name, status, created_by)
       VALUES ($1,$2,$3,'WS-0001','Estación El Ombú','active',$4) RETURNING id`,
      [org, farm, tipoEstacion, userId],
    );

    const lecturas: string[] = [];
    const args: unknown[] = [org, estacion];
    const push = (metric: string, value: number, unit: string, at: Date) => {
      args.push(metric, value.toFixed(2), unit, at.toISOString());
      const n = args.length;
      lecturas.push(`($1,$2,$${n - 3},$${n - 2},$${n - 1},$${n})`);
    };
    for (let d = 365; d >= 0; d--) {
      const at = daysAgo(d);
      at.setUTCHours(12, 0, 0, 0);
      // Estacionalidad simple del hemisferio norte (Venezuela): el pico de calor a mitad de año.
      const estacional = Math.sin(((365 - d) / 365) * 2 * Math.PI - Math.PI / 2);
      const tMax = 31 + 4 * estacional + between(-2, 2);
      const tMin = 21 + 3 * estacional + between(-2, 2);
      const seca = d <= SECA_DESDE && d >= SECA_HASTA;
      // En la seca llueve casi nunca; fuera de ella, un día de cada tres.
      const llueve = seca ? rand() < 0.06 : rand() < 0.34;
      const mm = llueve ? between(2, seca ? 6 : 34) : 0;
      push('temp_max', tMax, 'c', at);
      push('temp_min', tMin, 'c', at);
      push('temp', (tMax + tMin) / 2, 'c', at);
      push('humidity', seca ? between(40, 62) : between(62, 88), 'un', at);
      push('rain', mm, 'ml', at);
      // ETP más alta en la seca: más sol y menos humedad evaporan más, que es lo que hunde el balance.
      push('etp', seca ? between(5.5, 7.5) : between(3.2, 5.2), 'ml', at);
    }
    // Una sola sentencia: 365 días × 6 métricas son 2.190 filas, y de a una el seed tarda minutos.
    await q(`INSERT INTO sensor_readings (tenant_id, device_id, metric, value, unit, recorded_at) VALUES ${lecturas.join(',')}`, args);
  }

  // ── Pastoreo: rotación con pesaje de entrada y salida (Fase 3.2) ─────────────────────
  //
  // El pesaje al entrar y al salir NO es un detalle del seed: es la única forma de atribuirle kilos
  // a un potrero. La ganancia entre dos pesajes cualesquiera pudo haber pasado en otro lado, y por
  // eso el reporte solo cuenta animales con dos pesajes DENTRO de la ventana.
  //
  // Un potrero queda a propósito sin pesar: la pantalla tiene que distinguir «rindió poco» de
  // «nadie lo midió», que son conclusiones opuestas.
  {
    const rotaciones: [number, number, number, number][] = [
      // [potrero, lote, entra hace N días, sale hace N días]
      [0, 0, 320, 288],
      [3, 1, 300, 265],
      [2, 2, 250, 215],
      [5, 3, 200, 170],
      // Éste cae de lleno en la seca: va a rendir menos, y no por ser mal potrero.
      [0, 0, 145, 110],
      [3, 1, 140, 100],
      [2, 2, 80, 45],
      [5, 3, 60, 25],
    ];
    // El potrero 4 se ocupa pero nadie pasa la balanza.
    const sinPesar = new Set([8]);
    rotaciones.push([4, 2, 340, 305]);

    for (let i = 0; i < rotaciones.length; i++) {
      const [pi, li, entra, sale] = rotaciones[i];
      const entryDate = daysAgo(entra).toISOString().slice(0, 10);
      const exitDate = daysAgo(sale).toISOString().slice(0, 10);
      await q(
        `INSERT INTO grazing_records (tenant_id, paddock_id, lot_id, entry_date, exit_date, pre_grazing_kg_dm_ha, post_grazing_kg_dm_ha, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [org, paddocks[pi], lots[li], entryDate, exitDate, Math.round(between(2200, 3400)), Math.round(between(900, 1600)), userId],
      );
      if (sinPesar.has(i)) continue;

      // Pesar a la entrada y a la salida a los animales del lote. La ganancia diaria cae en la
      // seca: es la señal que la pantalla tiene que poder explicar con el balance hídrico.
      const delLote = await q(`SELECT id FROM animals WHERE tenant_id=$1 AND current_lot_id=$2 AND deleted_at IS NULL LIMIT 12`, [org, lots[li]]);
      const enSeca = entra <= SECA_DESDE && sale >= SECA_HASTA;
      const gdp = enSeca ? between(0.18, 0.34) : between(0.62, 0.95);
      const dias = entra - sale;
      for (const a of delLote) {
        const [{ base }] = await q(
          `SELECT COALESCE(max(weight_kg), 240)::float AS base FROM weighings WHERE tenant_id=$1 AND animal_id=$2 AND deleted_at IS NULL AND weighed_at <= $3`,
          [org, a.id, daysAgo(entra).toISOString()],
        );
        const kgEntrada = Math.round(Number(base) + between(-6, 6));
        await q(
          `INSERT INTO weighings (tenant_id, animal_id, weighed_at, weight_kg, method, created_by) VALUES ($1,$2,$3,$4,'scale',$5), ($1,$2,$6,$7,'scale',$5)`,
          [org, a.id, daysAgo(entra).toISOString(), kgEntrada, userId, daysAgo(sale).toISOString(), Math.round(kgEntrada + gdp * dias + between(-4, 4))],
        );
      }
    }
  }

  // ── Laboratorio: muestras y resultados (Fase 3.1) ────────────────────────────────────
  //
  // Sin esto la pantalla de Laboratorio arranca vacía y el lazo con Sanidad es invisible: nadie
  // descubre que un resultado puede abrir un caso clínico si no hay un resultado que mirar.
  //
  // Se siembran las TRES ramas de la regla a propósito, porque la que se entiende mal es la del
  // medio:
  //
  //   1. Normal            → no pasa nada.
  //   2. Anormal SIN diagnóstico → no abre caso; queda el botón «Abrir caso» para el veterinario.
  //   3. Anormal sin animal (suelo) → no corresponde caso, y la pantalla lo dice.
  //
  // La rama que abre el caso sola NO se siembra: crear el caso acá significaría repetir en el seed
  // lo que hace `ClinicalCaseService` (caso + evento del caso + evento del animal + máquina de
  // estados), y una regla escrita dos veces se desincroniza. Queda a un clic desde la rama 2, que
  // además es la forma en que el productor la va a descubrir.
  {
    const [{ id: labVet }] = await q(
      `INSERT INTO labs (tenant_id, name, type, contact, created_by) VALUES ($1,'Laboratorio Veterinario del Centro','pathology',$2,$3) RETURNING id`,
      [org, JSON.stringify({ email: 'lab@vetcentro.test', phone: '+58 212 555 0134' }), userId],
    );

    /** Muestra ya enviada al laboratorio, con su resultado. */
    const muestra = async (o: { tipo: string; animal?: string | null; potrero?: string | null; test: string; valor: string; rango?: string | null; anormal: boolean; diasAtras: number }) => {
      const tomada = daysAgo(o.diasAtras);
      const [{ id: sid }] = await q(
        `INSERT INTO lab_samples (tenant_id, lab_id, sample_type, animal_id, paddock_id, collected_at, sent_at, status, barcode, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'completed',$8,$9) RETURNING id`,
        [org, labVet, o.tipo, o.animal ?? null, o.potrero ?? null, tomada.toISOString(), new Date(tomada.getTime() + 86400000).toISOString(), `MB-${Math.round(between(10000, 99999))}`, userId],
      );
      await q(
        `INSERT INTO lab_results (tenant_id, sample_id, test_code, result_value, reference_range, is_abnormal, reported_at, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [org, sid, o.test, o.valor, o.rango ?? null, o.anormal, new Date(tomada.getTime() + 3 * 86400000).toISOString(), userId],
      );
    };

    // El novillo que ya venía con cuadro respiratorio: el hemograma da alterado y NADIE decidió
    // todavía qué es. Es el caso que la Fase 3.1 vino a resolver.
    await muestra({ tipo: 'blood', animal: sick.id, test: 'Hemograma — leucocitos', valor: '18.400/µL', rango: '4.000-12.000', anormal: true, diasAtras: 4 });
    await muestra({ tipo: 'blood', animal: pick(cows).id, test: 'Perfil mineral — cobre', valor: '0,58 ppm', rango: '0,60-1,20', anormal: true, diasAtras: 11 });
    await muestra({ tipo: 'milk', animal: pick(cows).id, test: 'Recuento celular', valor: '148.000 cél/mL', rango: '< 200.000', anormal: false, diasAtras: 9 });
    // Suelo: importa, y no es un caso clínico de nadie.
    await muestra({ tipo: 'soil', potrero: paddocks[1], test: 'Fósforo disponible', valor: '6 ppm', rango: '> 12', anormal: true, diasAtras: 25 });
  }

  // ── Faena: novillos terminados (cierra la cadena genética hasta el gancho) ────────────
  // Es el último escalón: pajuela → vaca → preñez → destete → GANCHO. Sin reses cargadas, la
  // evaluación por toro se corta en el destete y no puede contestar qué genética rinde en la res,
  // que es donde se cobra.
  //
  // El rendimiento DEPENDE DEL PADRE, igual que el peso al destete: si fuera azar, la comparación
  // entre toros no tendría señal y la demo enseñaría a leer ruido.
  {
    const torosFaena = animalIds.filter((a) => a.catCode === 'toro').map((a) => a.id);
    const novillos = animalIds.filter((a) => a.catCode === 'novillo').slice(0, 6);
    // El frigorífico es un CLIENTE: socio de negocio + su satélite `customers`, que es a donde
    // apunta la FK de la res (no a `business_partners`).
    const [{ id: socioFrigorifico }] = await q(
      `INSERT INTO business_partners (tenant_id, company_id, type, name) VALUES ($1,$2,'customer','Frigorífico del Centro') RETURNING id`,
      [org, company],
    );
    const [{ id: frigorifico }] = await q(
      `INSERT INTO customers (tenant_id, partner_id, segment) VALUES ($1,$2,'slaughterhouse') RETURNING id`,
      [org, socioFrigorifico],
    );
    for (const n of novillos) {
      const [{ sire_id: padre }] = await q(`SELECT sire_id FROM animals WHERE id = $1`, [n.id]);
      const efectoPadre = padre ? [1.8, 0, -1.4][torosFaena.indexOf(padre) % 3] : 0;
      // La res se deriva del ÚLTIMO PESO REAL del animal, no de uno inventado aparte. El novillo ya
      // tiene pesajes del seed general, y crear otro peso vivo solo para la faena daba dos verdades
      // del mismo número: el rendimiento salía 78%, que es imposible (lo normal es 55-58%).
      const [{ weight_kg: ultimo, weighed_at: fechaPeso }] = await q(
        `SELECT weight_kg::float AS weight_kg, weighed_at FROM weighings WHERE animal_id = $1 ORDER BY weighed_at DESC LIMIT 1`,
        [n.id],
      );
      const vivo = Number(ultimo);
      // La faena va DESPUÉS del último pesaje. Si fuera antes, la consulta tomaría un pesaje más
      // viejo y liviano, y el rendimiento saldría inflado (daba 60-65%, imposible para novillo).
      const faenaEn = new Date(new Date(fechaPeso).getTime() + 2 * 86400000);
      const rinde = between(55, 58) + efectoPadre;
      await q(
        `INSERT INTO carcass_records (tenant_id, animal_id, slaughter_date, slaughterhouse_id, hot_carcass_weight_kg, fat_grade, conformation, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          org,
          n.id,
          faenaEn.toISOString().slice(0, 10),
          frigorifico,
          +((vivo * rinde) / 100).toFixed(1),
          pick(['1', '2', '2', '3']),
          pick(['R', 'R', 'U', 'O']),
          userId,
        ],
      );
    }
  }

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
    [await hashPassword('ombu1234')],
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
