/**
 * Columnas de `animals` que participan del canal de sincronización (whitelist).
 * Fuente ÚNICA (P2 P-b.1): la consumen tanto `AnimalSyncHandler` (qué campos puede
 * escribir un put entrante) como `persistNewAnimal` con `sync='server_origin'`
 * (qué campos lleva el `syncOp` de un animal creado server-side, P-b.2). Evita
 * que las dos rutas de sync de `animals` diverjan (regla permanente 1).
 *
 * No incluye `visual_tag` ni `category_code`: son campos lógicos del cliente que
 * el handler resuelve aparte (identificador visual / category_id).
 *
 * `origin` entró con el alta rápida del móvil. El INSERT del handler lo pone en `'born'` fijo, que
 * era verdad mientras lo único que creaba animales offline era el PARTO. Desde que el productor
 * puede dar de alta a mano —y lo típico que se da de alta a mano es un animal COMPRADO— ese fijo
 * pasó a ser una mentira silenciosa, y `origin` alimenta la tasa de reposición de los KPIs de cría:
 * comprar veinte vaquillonas y que el sistema las cuente como propias da vuelta el indicador.
 */
export const ANIMAL_SYNCABLE_FIELDS = new Set([
  'name',
  'status',
  'current_lot_id',
  'current_paddock_id',
  'notes',
  'birth_date',
  'sex',
  'coat_color',
  'dam_id',
  'sire_id',
  'origin',
]);
