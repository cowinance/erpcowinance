/**
 * Nombres de tabla que participan del protocolo de sync — fuente única para
 * evitar typos al declarar `SyncHandler.table` o registrar un handler nuevo
 * (F6). No es el catálogo completo de las 140 tablas del schema, solo las
 * que hoy participan de sync (PutOp/EventOp) — se amplía a medida que un
 * módulo nuevo se suma al protocolo, no antes.
 */
export type SyncTable =
  | 'animals'
  | 'animal_movements'
  | 'mortalities'
  | 'pregnancies'
  | 'weighings'
  | 'animal_events'
  | 'vaccinations'
  | 'treatments'
  | 'breeding_events'
  | 'calvings'
  | 'calving_offspring';
