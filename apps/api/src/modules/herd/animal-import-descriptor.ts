/**
 * Descriptor de importación de ANIMAL (P2 oleada 3.2) — conocimiento de dominio
 * de Herd sobre "qué campos canónicos acepta un alta de animal por importación,
 * con qué encabezados de origen se auto-mapean, y cuáles son obligatorios".
 *
 * Es solo METADATOS puros (sin DB, sin Nest, sin endpoint): lo consume
 * `ImportModule` para armar el mapping sugerido y construir el `RawAnimalRow`
 * que valida `AnimalWriteService` (D1). La regla del animal sigue siendo de Herd.
 *
 * Alcance deliberado (Interpretación B): un ÚNICO descriptor (animal); NO hay
 * registry multi-entidad ni DSL — se extraerán cuando aparezca el 2.º caso real.
 * `field` coincide con las claves de `RawAnimalRow` de `animal-write.service.ts`.
 * `synonyms` van NORMALIZADOS (minúsculas, sin acentos) para que el matching de
 * encabezados compare contra la misma forma.
 */

export type AnimalImportField =
  | 'tag'
  | 'sex'
  | 'category_code'
  | 'name'
  | 'birth_date'
  | 'origin'
  | 'dam_tag'
  | 'sire_tag'
  // Auditoría Fase 3c — el alta por planilla ya acepta lo mismo que el alta manual:
  | 'breed'
  | 'rfid'
  | 'official_id'
  | 'lot';

export interface ImportFieldDescriptor {
  field: AnimalImportField;
  label: string;
  required: boolean;
  synonyms: string[];
}

export interface EntityImportDescriptor {
  entityType: 'animal';
  fields: ImportFieldDescriptor[];
}

export const ANIMAL_IMPORT_DESCRIPTOR: EntityImportDescriptor = {
  entityType: 'animal',
  fields: [
    { field: 'tag', label: 'Caravana', required: true, synonyms: ['caravana', 'arete', 'chapeta', 'crotal', 'rp', 'tag', 'numero', 'id visual'] },
    { field: 'sex', label: 'Sexo', required: true, synonyms: ['sexo', 'sex', 's'] },
    { field: 'category_code', label: 'Categoria', required: true, synonyms: ['categoria', 'category', 'cat', 'clase'] },
    { field: 'name', label: 'Nombre', required: false, synonyms: ['nombre', 'name'] },
    { field: 'birth_date', label: 'Fecha de nacimiento', required: false, synonyms: ['nacimiento', 'fecha nacimiento', 'fecha_nacimiento', 'birth', 'birthdate', 'fecha'] },
    { field: 'origin', label: 'Origen', required: false, synonyms: ['origen', 'origin'] },
    { field: 'dam_tag', label: 'Caravana de la madre', required: false, synonyms: ['madre', 'dam', 'caravana madre', 'madre caravana', 'id madre'] },
    { field: 'sire_tag', label: 'Caravana del padre', required: false, synonyms: ['padre', 'sire', 'caravana padre', 'padre caravana', 'id padre'] },
    { field: 'breed', label: 'Raza', required: false, synonyms: ['raza', 'breed', 'razas'] },
    { field: 'rfid', label: 'RFID', required: false, synonyms: ['rfid', 'electronico', 'caravana electronica', 'chip', 'bolo', 'eid'] },
    { field: 'official_id', label: 'ID oficial', required: false, synonyms: ['id oficial', 'oficial', 'senasa', 'dicose', 'siniiga', 'identificacion oficial'] },
    { field: 'lot', label: 'Lote', required: false, synonyms: ['lote', 'lot', 'rodeo', 'grupo', 'potrero lote'] },
  ],
};

/** Campos obligatorios del descriptor (deben mapearse antes de previsualizar/commit). */
export const REQUIRED_ANIMAL_IMPORT_FIELDS: AnimalImportField[] = ANIMAL_IMPORT_DESCRIPTOR.fields
  .filter((f) => f.required)
  .map((f) => f.field);
