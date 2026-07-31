import type { TxHandle } from './driver';
import { hashPassword } from '../common/passwords';
import { polygonAreaHa } from '@cowinance/domain';

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

  /*
   * Razas bovinas del catálogo base.
   *
   * Estaba armado con razas ARGENTINAS —Angus, Hereford, Brangus, Braford, Holando— y esto lo carga
   * `bootstrapCatalogs`, así que lo recibía TODA finca, no solo el demo. La app se usa en Venezuela:
   * un productor de allá importaba su planilla y el sistema le rechazaba fila por fila las razas de
   * su propio rodeo. Se descubrió auditando la importación, cuando Brahman, Nelore y Gyr —las tres
   * más comunes del país— resultaron inexistentes.
   *
   * Se AGREGAN sin sacar las que estaban: un catálogo de más no molesta a nadie, y borrar razas de
   * un catálogo que ya está desplegado rompería los animales que las tengan puestas.
   *
   * El `purpose` importa: en Venezuela el DOBLE PROPÓSITO es la forma dominante de producir —el
   * mismo animal da leche y carne— y por eso varias van como `dual` y no forzadas a una u otra.
   */
  await q(
    `INSERT INTO breeds (species_id, code, name, purpose) VALUES
     -- Desarrolladas en Venezuela. La Carora nació en Carora, estado Lara, cruzando Pardo Suizo con
     -- Criollo Limonero para tener una lechera que aguante el trópico; es de las principales del
     -- país. El Limonero es la criolla del Zulia, y la madre de la Carora.
     ($1,'carora','Carora','dairy'),
     ($1,'criollo_limonero','Criollo Limonero','dairy'),
     -- Cebuínas: la base del rodeo de carne en el trópico, porque resisten calor y garrapata.
     ($1,'brahman','Brahman','beef'),
     ($1,'nelore','Nelore','beef'),
     ($1,'gyr','Gyr','dual'),
     ($1,'guzerat','Guzerat','dual'),
     ($1,'indubrasil','Indubrasil','beef'),
     ($1,'sardo_negro','Sardo Negro','beef'),
     -- Cruces de doble propósito, que es como produce la mayoría.
     ($1,'girolando','Girolando','dual'),
     ($1,'mestizo','Mestizo','dual'),
     -- Europeas de leche. «Holstein» y no «Holando Argentino»: es el nombre que se usa allá.
     ($1,'holstein','Holstein','dairy'),
     ($1,'pardo_suizo','Pardo Suizo','dual'),
     ($1,'jersey','Jersey','dairy'),
     -- Carne, adaptadas al trópico.
     ($1,'senepol','Senepol','beef'),
     ($1,'romosinuano','Romosinuano','beef'),
     ($1,'simmental','Simmental','dual'),
     -- Las que ya estaban. Se conservan: hay fincas del Cono Sur y borrarlas dejaría animales
     -- apuntando a una raza que ya no existe.
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
  // Se marcan como notificables las de denuncia obligatoria ante la autoridad sanitaria (aftosa,
  // brucelosis, tuberculosis y carbunclo lo son en todos los países del catálogo).
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
  /*
   * El tenant principal es VENEZOLANO y lleva sus libros en USD, que es el caso del producto: el
   * vertical fiscal entero (G4) está construido sobre el SENIAT y el RIF, y el negocio se pacta y
   * se costea en dólares. Antes el encabezado decía Argentina/ARS mientras TODAS las ventas que
   * este mismo seed escribe estaban en USD, y ya había un socio con RIF venezolano: el demo se
   * contradecía a sí mismo y mandaba a la app móvil la zona horaria equivocada.
   *
   * El segundo tenant ("El Ombú") queda argentino A PROPÓSITO — ver más abajo.
   */
  const [{ id: userId }] = await q(
    `INSERT INTO users (email, full_name, locale, password_hash) VALUES ('cowinance@gmail.com','Jose Montilla','es-VE',$1) RETURNING id`,
    [await hashPassword('cowinance')],
  );
  const [{ id: org }] = await q(
    `INSERT INTO organizations (name, legal_name, country_code, default_currency, default_locale, timezone, created_by)
     VALUES ('Grupo La Esperanza','Grupo La Esperanza, C.A.','VE','USD','es-VE','America/Caracas',$1) RETURNING id`,
    [userId],
  );
  // RLS: a partir de acá, las inserciones con tenant_id necesitan el GUC
  await q(`SELECT set_config('app.tenant_id', $1, false)`, [org]);
  await q(`INSERT INTO user_role_assignments (tenant_id, user_id, role_id) VALUES ($1,$2,$3)`, [org, userId, ownerRole]);
  /*
   * RIF con dígito verificador VÁLIDO y las dos columnas juntas, igual que las escribe
   * `IssuerService`: `tax_id` es lo que se imprime y `tax_id_normalized` es la clave con la que se
   * compara. Sembrar solo una dejaría al emisor del demo con `can_issue: true` sobre un RIF que la
   * app rechazaría si lo cargaran por la UI.
   */
  const [{ id: company }] = await q(
    `INSERT INTO companies (tenant_id, name, tax_id, tax_id_normalized, taxpayer_condition, country_code, functional_currency, created_by)
     VALUES ($1,'Agropecuaria La Esperanza, C.A.','J-31234567-5','J312345675','ordinario','VE','USD',$2) RETURNING id`,
    [org, userId],
  );
  /*
   * `official_code` es el registro del predio ante el INSAI (la autoridad de trazabilidad de VE
   * según el catálogo de países). NO conozco el formato oficial real, así que va un valor
   * declaradamente de demo en vez de uno inventado con apariencia de oficial — antes acá había un
   * RENSPA, que es de SENASA (Argentina).
   */
  const [{ id: farm }] = await q(
    `INSERT INTO farms (tenant_id, company_id, name, official_code, total_area_ha, timezone, created_by)
     VALUES ($1,$2,'Hato La Esperanza','INSAI DEMO-000123',850,'America/Caracas',$3) RETURNING id`,
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
    /*
     * La superficie sale del DIBUJO, no del número de la tabla de arriba.
     *
     * Los dos venían del seed por separado y no coincidían: «Loma Sur» declaraba 140 ha y su
     * polígono medía 80, así que la carga animal del mapa salía 43% corrida y los kg/ha del
     * rendimiento con ella. Peor: desde que la superficie de un potrero dibujado es DERIVADA, ese
     * estado ya no se puede crear por la API — el seed estaba fabricando datos que el producto
     * rechaza.
     *
     * El número de `paddockDefs` queda como referencia de cuánto se pretendía que midiera cada uno;
     * el que vale es el que se mide sobre lo dibujado, igual que en la app.
     */
    const [{ id }] = await q(
      `INSERT INTO paddocks (tenant_id, farm_id, name, boundary, area_ha, pasture_type, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [org, farm, name, boundary, polygonAreaHa(JSON.parse(boundary)), pasture, userId],
    );
    paddocks.push(id);
    void area;
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

  // El ítem de gasoil lo crea Maquinaria y lo necesita Inventario para que el kardex explique de
  // dónde salieron los litros. Se declara acá para que el orden entre los dos bloques sea explícito.
  let gasoilItem = '';

  // ── Maquinaria: flota con cargas y services (Fase 4) ─────────────────────────────────
  //
  // La comparación entre máquinas solo enseña algo si las máquinas son distintas ENTRE SÍ de las
  // maneras que importan, y son tres:
  //
  //   - El tractor nuevo: se mide en horas, gasta en service programado. Es la referencia.
  //   - El tractor viejo: mismas horas, y casi todo el mantenimiento es por ROTURA. Ése es el que
  //     hay que poder ver, y el costo total solo no lo muestra.
  //   - La camioneta: se mide en KILÓMETROS. Existe para que la pantalla tenga que no mezclarla en
  //     el mismo ranking; un «costo por hora» de camioneta no significa nada.
  //
  // Y una cuarta a la que nadie le anotó el horómetro: sin dos lecturas no hay costo por hora, y la
  // pantalla tiene que decir eso en vez de mostrarla como la más barata de todas.
  {
    const flota: [string, string, number, 'hours' | 'km' | 'none', number][] = [
      // [nombre, tipo, año, medidor, horas/km al inicio del período]
      ['Tractor John Deere 5090', 'tractor', 2021, 'hours', 2400],
      ['Tractor Ford 6600', 'tractor', 1998, 'hours', 11800],
      ['Camioneta Toyota Hilux', 'truck', 2019, 'km', 96000],
      ['Mixer Mainero', 'mixer', 2017, 'none', 0],
    ];
    const [{ id: gasoil }] = await q(
      `INSERT INTO inventory_items (tenant_id, name, unit, created_by) VALUES ($1,'Gasoil','l',$2) RETURNING id`,
      [org, userId],
    );
    gasoilItem = gasoil;

    for (const [nombre, tipo, anio, medidor, inicio] of flota) {
      const [{ id: maquina }] = await q(
        `INSERT INTO machinery (tenant_id, farm_id, name, type, make, year, engine_hours, odometer_km, status, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active',$9) RETURNING id`,
        [org, farm, nombre, tipo, nombre.split(' ')[1] ?? null, anio, medidor === 'hours' ? inicio + 900 : null, medidor === 'km' ? inicio + 24000 : null, userId],
      );
      const viejo = anio < 2005;

      // Cargas de combustible cada tres semanas, con el medidor anotado (salvo el mixer).
      for (let i = 0; i < 17; i++) {
        const dias = 360 - i * 21;
        const litros = +between(90, 160).toFixed(1);
        const precio = +between(0.9, 1.15).toFixed(3);
        const avance = medidor === 'km' ? Math.round((24000 / 17) * (i + 1)) : Math.round((900 / 17) * (i + 1));
        await q(
          `INSERT INTO fuel_logs (tenant_id, machinery_id, fueled_at, item_id, liters, engine_hours, odometer_km, unit_cost, total_cost, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            org, maquina, daysAgo(dias).toISOString(), gasoil, litros,
            medidor === 'hours' ? inicio + avance : null,
            medidor === 'km' ? inicio + avance : null,
            precio, +(litros * precio).toFixed(2), userId,
          ],
        );
      }

      // El viejo se rompe; el nuevo se mantiene. Misma plata, señal opuesta.
      const services: [string, number, number][] = viejo
        ? [['corrective', 300, 620], ['corrective', 190, 480], ['corrective', 95, 910], ['preventive', 20, 180]]
        : [['preventive', 320, 210], ['preventive', 150, 240], ['inspection', 40, 90]];
      for (const [tipoServ, dias, costo] of services) {
        await q(
          `INSERT INTO maintenance_records (tenant_id, machinery_id, type, performed_at, description, engine_hours, cost, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            org, maquina, tipoServ, daysAgo(dias).toISOString(),
            tipoServ === 'corrective' ? 'Reparación de urgencia' : 'Service programado',
            medidor === 'hours' ? inicio + Math.round((900 * (360 - dias)) / 360) : null,
            costo, userId,
          ],
        );
      }
    }
  }

  // ── Inventario: depósito, ítems y kardex (Fase 4) ────────────────────────────────────
  //
  // La pantalla de rotación solo enseña algo si los ítems se diferencian en lo que decide una
  // compra, y son cuatro situaciones distintas:
  //
  //   - El que se consume parejo y ALCANZA: la referencia.
  //   - El que se consume parejo y NO llega a cubrir la reposición: hay que pedirlo hoy.
  //   - El DORMIDO: tiene saldo y hace meses que nadie lo toca. Es plata quieta, no stock de sobra,
  //     y a ojo se ven igual.
  //   - El que tiene un MÍNIMO cargado a mano que quedó viejo: la alerta de stock bajo depende de
  //     ese número, y cuando está mal avisa siempre (y se ignora) o avisa tarde (y se corta).
  //
  // El saldo se calcula DESDE los movimientos sembrados, no aparte: `stock_levels` es un saldo
  // materializado y un demo donde el kardex y el saldo no coinciden enseñaría a desconfiar de los
  // dos. Es la misma cuenta que hace `recordMovementInTx`, sobre las mismas filas.
  {
    const [{ id: deposito }] = await q(
      `INSERT INTO warehouses (tenant_id, farm_id, name, created_by) VALUES ($1,$2,'Galpón Central',$3) RETURNING id`,
      [org, farm, userId],
    );
    const [{ id: catInsumos }] = await q(
      `INSERT INTO inventory_categories (tenant_id, name, kind, created_by) VALUES ($1,'Insumos','supply',$2) RETURNING id`,
      [org, userId],
    );

    /** [nombre, unidad, costo, compra inicial, consumo por entrega, entregas, mínimo a mano] */
    const insumos: [string, string, number, number, number, number, number | null][] = [
      ['Ración balanceada 18%', 'kg', 0.42, 24000, 900, 22, null],
      // Se consume parejo y el saldo no cubre los 30 días de reposición: hay que pedirlo hoy.
      ['Antiparasitario Ivermectina', 'l', 38, 40, 2.2, 16, null],
      // Comprado para una campaña que no se hizo: hace más de medio año que nadie lo toca.
      ['Herbicida Glifosato', 'l', 6.5, 600, 0, 0, null],
      // Mínimo cargado hace años, muy por encima de lo que hoy se consume.
      ['Sal mineralizada', 'kg', 0.75, 8000, 260, 20, 4000],
    ];

    for (const [nombre, unidad, costo, compra, porEntrega, entregas, minimo] of insumos) {
      const [{ id: item }] = await q(
        `INSERT INTO inventory_items (tenant_id, category_id, name, unit, reorder_point, standard_cost, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [org, catInsumos, nombre, unidad, minimo, costo, userId],
      );
      await q(
        `INSERT INTO stock_movements (tenant_id, item_id, warehouse_id, movement_type, quantity, unit_cost, occurred_at, reference_type, created_by)
         VALUES ($1,$2,$3,'in',$4,$5,$6,'purchase',$7)`,
        [org, item, deposito, compra, costo, daysAgo(200).toISOString(), userId],
      );
      for (let i = 0; i < entregas; i++) {
        await q(
          `INSERT INTO stock_movements (tenant_id, item_id, warehouse_id, movement_type, quantity, unit_cost, occurred_at, reference_type, created_by)
           VALUES ($1,$2,$3,'consumption',$4,$5,$6,'feed_delivery',$7)`,
          [org, item, deposito, -porEntrega, costo, daysAgo(190 - i * 8).toISOString(), userId],
        );
      }
    }

    // Gasoil: las cargas de la flota salieron de algún lado. Sin esto, el ítem quedaría en cero y
    // el demo diría que la finca cargó combustible sin tenerlo.
    const [{ litros }] = await q(`SELECT COALESCE(sum(liters),0)::float AS litros FROM fuel_logs WHERE tenant_id=$1`, [org]);
    if (Number(litros) > 0) {
      await q(
        `INSERT INTO stock_movements (tenant_id, item_id, warehouse_id, movement_type, quantity, unit_cost, occurred_at, reference_type, created_by)
         VALUES ($1,$2,$3,'in',$4,1.02,$5,'purchase',$6)`,
        [org, gasoilItem, deposito, Math.ceil(Number(litros) * 1.15), daysAgo(365).toISOString(), userId],
      );
      const cargas = await q(`SELECT id, liters::float AS liters, fueled_at FROM fuel_logs WHERE tenant_id=$1 ORDER BY fueled_at`, [org]);
      for (const c of cargas)
        await q(
          `INSERT INTO stock_movements (tenant_id, item_id, warehouse_id, movement_type, quantity, unit_cost, occurred_at, reference_type, reference_id, created_by)
           VALUES ($1,$2,$3,'consumption',$4,1.02,$5,'fuel_log',$6,$7)`,
          [org, gasoilItem, deposito, -c.liters, c.fueled_at, c.id, userId],
        );
    }

    // El saldo materializado, derivado de los mismos movimientos: kardex y saldo no pueden discrepar.
    await q(
      `INSERT INTO stock_levels (tenant_id, item_id, warehouse_id, quantity, avg_cost, created_by)
       SELECT m.tenant_id, m.item_id, m.warehouse_id, sum(m.quantity),
              -- Costo promedio de lo que ENTRÓ: el promedio sobre todos los movimientos incluiría
              -- las salidas y daría un número que no fue el de ninguna compra.
              CASE WHEN sum(m.quantity) FILTER (WHERE m.quantity > 0) > 0
                   THEN sum(m.quantity * m.unit_cost) FILTER (WHERE m.quantity > 0)
                        / sum(m.quantity) FILTER (WHERE m.quantity > 0) END,
              $2
         FROM stock_movements m
        WHERE m.tenant_id = $1 AND m.deleted_at IS NULL
        GROUP BY m.tenant_id, m.item_id, m.warehouse_id`,
      [org, userId],
    );
  }

  // ── Agricultura: campaña con lotes que rindieron distinto (Fase 4) ───────────────────
  //
  // La comparación por cultivo solo enseña algo si hay VARIOS lotes del mismo cultivo y rindieron
  // distinto: con uno solo no hay índice, y con dos iguales no hay nada que mirar.
  //
  //   - Dos lotes de maíz, uno bastante peor que el otro: es la fila que hay que poder ver.
  //   - Un lote de sorgo cosechado y VENDIDO: es el único que puede tener margen, porque el precio
  //     sale de una venta real y no de un supuesto.
  //   - Un lote de maíz sembrado y todavía sin cosechar: tiene costo por hectárea y no tiene rinde.
  //     La pantalla tiene que distinguirlo de uno que rindió mal.
  {
    const [{ id: itemMaiz }] = await q(
      `INSERT INTO inventory_items (tenant_id, name, unit, created_by) VALUES ($1,'Maíz grano','kg',$2) RETURNING id`,
      [org, userId],
    );
    const [{ id: itemSorgo }] = await q(
      `INSERT INTO inventory_items (tenant_id, name, unit, created_by) VALUES ($1,'Sorgo grano','kg',$2) RETURNING id`,
      [org, userId],
    );

    /** [potrero, cultivo, ha, kg cosechados (0 = sin cosechar), costo total, ítem destino] */
    const campania: [number, string, number, number, number, string | null][] = [
      [1, 'maiz', 45, 337500, 21600, itemMaiz], // 7.500 kg/ha
      [4, 'maiz', 38, 190000, 19000, itemMaiz], // 5.000 kg/ha — bastante peor
      [2, 'maiz', 30, 0, 12800, null], // sembrado, sin cosechar
      [5, 'sorgo', 25, 137500, 9500, itemSorgo], // 5.500 kg/ha, y se vendió
    ];

    for (const [pi, cultivo, ha, kg, costo, destino] of campania) {
      const siembra = daysAgo(260);
      const [{ id: crop }] = await q(
        `INSERT INTO crops (tenant_id, paddock_id, crop_type, variety, planting_date, expected_harvest_date, area_ha, status, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [
          org, paddocks[pi], cultivo, cultivo === 'maiz' ? 'DK 7210' : 'Advanta 1500',
          siembra.toISOString().slice(0, 10), daysAgo(120).toISOString().slice(0, 10), ha,
          kg > 0 ? 'harvested' : 'growing', userId,
        ],
      );

      // Las labores reparten el costo total: si fuera una sola línea, el costo por hectárea sería
      // igual de correcto y la pantalla de labores no se parecería a la de una finca.
      const labores: [string, number, number][] = [
        ['planting', 250, 0.35],
        ['fertilization', 235, 0.4],
        ['spraying', 200, 0.15],
        ...(kg > 0 ? ([['harvest', 125, 0.1]] as [string, number, number][]) : []),
      ];
      for (const [tipo, dias, parte] of labores)
        await q(
          `INSERT INTO crop_operations (tenant_id, crop_id, operation_type, performed_at, cost, created_by) VALUES ($1,$2,$3,$4,$5,$6)`,
          [org, crop, tipo, daysAgo(dias).toISOString(), +(costo * parte).toFixed(2), userId],
        );

      if (kg > 0)
        await q(
          `INSERT INTO harvests (tenant_id, crop_id, harvest_date, yield_quantity, yield_unit, yield_per_ha, moisture_pct, destination_item_id, created_by)
           VALUES ($1,$2,$3,$4,'kg',$5,$6,$7,$8)`,
          [org, crop, daysAgo(120).toISOString().slice(0, 10), kg, +(kg / ha).toFixed(3), +between(13, 15.5).toFixed(1), destino, userId],
        );
    }

    // La venta del sorgo: sin ella no hay precio real y el margen no existe, que es exactamente lo
    // que la pantalla tiene que mostrar para el resto de los cultivos.
    const [{ id: acopio }] = await q(
      `INSERT INTO business_partners (tenant_id, company_id, type, name) VALUES ($1,$2,'customer','Acopio San Rafael') RETURNING id`,
      [org, company],
    );
    await q(`INSERT INTO customers (tenant_id, partner_id, segment) VALUES ($1,$2,'other')`, [org, acopio]);
    const [{ id: ventaGrano }] = await q(
      `INSERT INTO sales (tenant_id, company_id, customer_partner_id, document_number, sale_date, type, currency, subtotal, tax_total, total, status, created_by)
       VALUES ($1,$2,$3,'VTA-2026-0031',$4,'crop','USD',13750,0,13750,'delivered',$5) RETURNING id`,
      [org, company, acopio, daysAgo(100).toISOString().slice(0, 10), userId],
    );
    await q(
      `INSERT INTO sale_lines (tenant_id, sale_id, item_id, description, quantity, unit_price, tax_rate, line_total, created_by)
       VALUES ($1,$2,$3,'Sorgo grano cosecha 2026',137500,0.1,0,13750,$4)`,
      [org, ventaGrano, itemSorgo, userId],
    );
  }

  // ── RRHH: empleados y partes de trabajo (Fase 3.4) ───────────────────────────────────
  //
  // El corte «en qué se va la mano de obra» solo enseña algo si las horas se parecen a las de una
  // finca real, y en una finca real pasan las tres cosas a la vez:
  //
  //   - La alimentación se lleva MUCHAS horas baratas (la hace el operario).
  //   - La sanidad se lleva POCAS horas caras (la hace el veterinario).
  //   - El mantenimiento lo hace, en parte, alguien SIN tarifa cargada — así se ve más barato de lo
  //     que es, que es justamente la lectura que puede invertir la decisión de tercerizar.
  //
  // Y siempre hay jornadas sin tarea vinculada: horas que existen y de las que no se sabe en qué se
  // fueron. Se siembran a propósito para que la pantalla tenga que distinguirlas de una actividad.
  {
    const empleados: [string, string, number | null][] = [
      ['Ramón Gutiérrez', 'Capataz', 6.5],
      ['Luis Peña', 'Operario', 4.2],
      ['Dra. Carmen Ríos', 'Veterinaria', 18],
      // Sin tarifa: su trabajo es real y el sistema no lo puede poner en dólares.
      ['Jesús Marcano', 'Operario eventual', null],
    ];
    const empleadoIds: string[] = [];
    for (const [nombre, rol, tarifa] of empleados) {
      const [{ id }] = await q(
        `INSERT INTO employees (tenant_id, company_id, full_name, role, employment_type, hire_date, hourly_rate, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [org, company, nombre, rol, tarifa == null ? 'temporary' : 'permanent', daysAgo(between(300, 1200)).toISOString().slice(0, 10), tarifa, userId],
      );
      empleadoIds.push(id);
    }
    const [capataz, operario, veterinaria, eventual] = empleadoIds;

    /** Tarea ya hecha, del tipo indicado, para que el parte tenga a qué colgarse. */
    const tareaHecha = async (tipo: string, titulo: string, diasAtras: number) => {
      const cuando = daysAgo(diasAtras);
      const [{ id }] = await q(
        `INSERT INTO tasks (tenant_id, farm_id, title, type, due_date, priority, status, completed_at, created_by)
         VALUES ($1,$2,$3,$4,$5,'normal','done',$5,$6) RETURNING id`,
        [org, farm, titulo, tipo, cuando.toISOString(), userId],
      );
      return id as string;
    };
    const parte = async (empleado: string, tarea: string | null, diasAtras: number, horas: number) => {
      await q(
        `INSERT INTO work_logs (tenant_id, employee_id, work_date, hours, task_id, farm_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [org, empleado, daysAgo(diasAtras).toISOString().slice(0, 10), horas, tarea, farm, userId],
      );
    };

    for (let semana = 0; semana < 24; semana++) {
      const d = semana * 7 + 3;
      // Alimentación: todas las semanas, muchas horas del operario.
      const alimentacion = await tareaHecha('feeding', 'Reparto de ración y recorrida de comederos', d);
      await parte(operario, alimentacion, d, +between(6, 9).toFixed(1));
      await parte(capataz, alimentacion, d, +between(1, 2.5).toFixed(1));

      // Sanidad: cada tres semanas, pocas horas y caras.
      if (semana % 3 === 0) {
        const sanidad = await tareaHecha('health', 'Recorrida sanitaria y tratamientos', d - 1);
        await parte(veterinaria, sanidad, d - 1, +between(2.5, 4.5).toFixed(1));
        await parte(capataz, sanidad, d - 1, +between(1.5, 3).toFixed(1));
      }

      // Mantenimiento: cada dos semanas, y la mayor parte la hace el eventual SIN tarifa.
      if (semana % 2 === 1) {
        const mantenimiento = await tareaHecha('maintenance', 'Alambrados, bebederos y caminos', d + 1);
        await parte(eventual, mantenimiento, d + 1, +between(6, 9).toFixed(1));
        await parte(operario, mantenimiento, d + 1, +between(1, 2).toFixed(1));
      }

      // Reproducción: solo en la temporada de servicio.
      if (semana < 10) {
        const repro = await tareaHecha('breeding', 'Detección de celo y servicio', d + 2);
        await parte(capataz, repro, d + 2, +between(2, 4).toFixed(1));
      }

      // Y las jornadas que nadie vinculó a una tarea: existen en toda finca.
      if (semana % 4 === 0) await parte(operario, null, d + 4, +between(4, 8).toFixed(1));
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
    // El RIF va con el dígito verificador que le corresponde (era `-6`, y por el algoritmo cierra
    // en `-1`) y con la columna normalizada cargada: en un tenant venezolano ésa es la clave de
    // unicidad y de búsqueda, y en NULL el socio queda fuera del guardarraíl de duplicados.
    const [{ id: socioExportador }] = await q(
      `INSERT INTO business_partners (tenant_id, company_id, type, name, tax_id, tax_id_normalized) VALUES ($1,$2,'customer','Exportadora del Llano','J-30158742-1','J301587421') RETURNING id`,
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

  /*
   * ── Segundo tenant: prueba viviente del aislamiento RLS ─────────────────
   *
   * Y ARGENTINO A PROPÓSITO, ahora que el primero es venezolano. La identidad fiscal se valida POR
   * PAÍS —el algoritmo del RIF no se le puede aplicar a un CUIT— y esa bifurcación solo se ve con
   * dos tenants de países distintos. Que el demo tenga uno de cada lado hace que el camino no-VE
   * exista de verdad en la base y no solo en el `UPDATE` de preparación de un test.
   */
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
  /*
   * La estadía ACTUAL de cada lote en su potrero, abierta.
   *
   * Las rotaciones históricas de arriba quedan todas cerradas, así que sin esto ningún lote tenía
   * pastoreo abierto: la ocupación mostraba los potreros ocupados —eso ahora se deriva de dónde
   * están los lotes— pero sin desde cuándo, y los días de pastoreo salían en blanco. La app real ya
   * abre el pastoreo al rotar; esto es para que el demo se vea como se va a ver la finca.
   */
  await q(
    `INSERT INTO grazing_records (tenant_id, paddock_id, lot_id, entry_date, pre_grazing_kg_dm_ha, created_by)
     SELECT l.tenant_id, l.current_paddock_id, l.id, CURRENT_DATE - 18, 2800, $2
       FROM lots l
      WHERE l.tenant_id = $1 AND l.current_paddock_id IS NOT NULL AND l.deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM grazing_records g
                         WHERE g.lot_id = l.id AND g.tenant_id = l.tenant_id AND g.exit_date IS NULL AND g.deleted_at IS NULL)`,
    [org, userId],
  );

  /*
   * El ingreso de cada animal a su lote, para que el historial del lote no nazca vacío.
   *
   * El seed inserta el hato con su `current_lot_id` puesto —es una carga masiva, no pasa por los
   * servicios— y el historial del lote se arma con `animal_movements`. Sin esto el demo mostraba
   * lotes de 21 y 25 cabezas con CERO movimientos: animales que aparecieron de la nada, justo en la
   * pantalla que se llama trazabilidad. La app real ya registra el alta como ingreso; esto es para
   * que el demo se vea como se va a ver la finca.
   *
   * Una sola sentencia y no una por animal: es un seed, y el costo se paga en cada arranque de dev.
   */
  await q(
    `INSERT INTO animal_movements (tenant_id, animal_id, moved_at, from_lot_id, to_lot_id, from_paddock_id, to_paddock_id, reason, created_by, origin, movement_id)
     SELECT a.tenant_id, a.id, a.created_at, NULL, a.current_lot_id, NULL, a.current_paddock_id, 'alta del animal', $2, 'import', gen_random_uuid()
       FROM animals a
      WHERE a.tenant_id = $1 AND a.current_lot_id IS NOT NULL AND a.deleted_at IS NULL`,
    [org, userId],
  );

  // Restaurar el contexto del tenant principal para el resto del boot
  await q(`SELECT set_config('app.tenant_id', $1, false)`, [org]);

  console.log(
    `Seed: ${animalIds.length} animales (+5 de El Ombú), ${events.length} eventos, ${pregnant} preñeces. Usuarios: cowinance@gmail.com/cowinance · maria@elombu.com/ombu1234`,
  );
}
