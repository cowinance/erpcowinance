import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DbService } from '../../db/db.service';
import { SyncVersionStore } from '../sync/registry/sync-version.store';
import { ServerOriginChangesetWriter } from '../sync/registry/server-origin-changeset.writer';
import { AnimalWriteService } from '../herd/animal-write.service';
import { ImportService } from './import.service';
import { Sex } from '@cowinance/domain';
import { MovementService } from '../land/movement.service';

/**
 * La ayuda de la importación no puede mentir (O-4).
 *
 * La pantalla explicaba el formato del ARCHIVO —UTF-8, comas, 5 MB— y nada de su CONTENIDO: qué
 * columnas hacen falta, cómo se pueden titular, qué valores se aceptan. La única forma de
 * enterarse era subir el archivo y leer qué rebotaba.
 *
 * Ahora lo dice, y estos tests fijan lo único que hace peligrosa a una ayuda: que prometa algo que
 * el importador después rechaza. Un error del productor se corrige; un error que produjo la propia
 * guía destruye la confianza en todo lo demás que la app afirme.
 */
describe('la ayuda de la importación dice la verdad', () => {
  let db: DbService;
  let imports: ImportService;
  let animalWrite: AnimalWriteService;
  let originalCwd: string;
  let tmp: string;

  beforeAll(async () => {
    originalCwd = process.cwd();
    tmp = mkdtempSync(join(tmpdir(), 'import-guide-'));
    process.chdir(tmp);
    process.env.SEED_DEMO = 'on';
    db = new DbService();
    await db.onModuleInit();
    animalWrite = new AnimalWriteService(db, new SyncVersionStore(db), new ServerOriginChangesetWriter(db), new MovementService(db, new SyncVersionStore(db), new ServerOriginChangesetWriter(db)));
    imports = new ImportService(db, animalWrite);
  }, 120_000);

  afterAll(() => {
    process.chdir(originalCwd);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('TODO VALOR QUE SE ANUNCIA, EL IMPORTADOR LO ACEPTA', () => {
    // El invariante central. Si la ayuda dijera que se puede escribir «hembra» y la validación lo
    // rechazara, el productor escribiría exactamente lo que le pidieron y le rebotaría la fila.
    return imports.listFields('animal').then((campos) => {
      const sexo = campos.find((c) => c.field === 'sex')!;
      for (const v of sexo.accepts!)
        expect(Sex.parse(v), `la ayuda anuncia el sexo '${v}' y el importador no lo acepta`).not.toBeNull();
    });
  });

  it('las categorías que anuncia EXISTEN en la base', async () => {
    // Se leen de la tabla justamente para que no sea una lista copiada que envejece.
    const campos = await imports.listFields('animal');
    const anunciadas = campos.find((c) => c.field === 'category_code')!.accepts!;
    const reales = (await db.query<{ code: string }>(`SELECT code FROM animal_categories WHERE deleted_at IS NULL`)).map(
      (c) => c.code,
    );
    expect(anunciadas.length).toBeGreaterThan(0);
    for (const c of anunciadas) expect(reales, `la ayuda anuncia la categoría '${c}', que no existe`).toContain(c);
  });

  it('los encabezados que anuncia son los que el servidor auto-mapea', async () => {
    // Sin los sinónimos a la vista, la única forma de saber que la caravana también se puede
    // titular «arete» era probar. Se exponen, y tienen que ser los mismos que usa el matching.
    const campos = await imports.listFields('animal');
    const tag = campos.find((c) => c.field === 'tag')!;
    expect(tag.synonyms).toContain('caravana');
    expect(tag.synonyms).toContain('arete');
    expect(campos.every((c) => c.synonyms.length > 0)).toBe(true);
  });

  it('LA PLANILLA DE EJEMPLO SE IMPORTA SIN UN SOLO ERROR', async () => {
    // El test que importa de verdad: mucha gente baja la plantilla y la sube tal cual. La primera
    // versión armaba las filas mezclando cada campo por su lado y salía «hembra, novillo» —una
    // combinación que el propio importador rechaza—. Acá se valida fila por fila con la MISMA
    // validación que corre en la importación real, no con una copia.
    const t = await imports.templateRows('animal');
    const idx = (encabezado: string) => t.headers.indexOf(encabezado);

    expect(t.rows.length).toBeGreaterThan(0);
    for (const fila of t.rows) {
      const raw = {
        tag: fila[idx('caravana')],
        sex: fila[idx('sexo')],
        category_code: fila[idx('categoria')],
        birth_date: fila[idx('nacimiento')],
      };
      const r = animalWrite.normalizeAndValidate(raw);
      expect(r.ok, `la plantilla trae una fila que no valida: ${JSON.stringify(raw)} → ${JSON.stringify((r as any).errors)}`).toBe(true);

      // Y la categoría tiene que existir Y ser compatible con el sexo: «hembra, novillo» pasa la
      // validación pura y muere después, contra la base.
      const cat = await db.one<{ sex: string | null }>(`SELECT sex FROM animal_categories WHERE code = $1 AND deleted_at IS NULL`, [
        raw.category_code,
      ]);
      expect(cat, `la plantilla sugiere la categoría '${raw.category_code}', que no existe`).toBeTruthy();
      if (cat!.sex && cat!.sex !== 'any')
        expect(cat!.sex, `la plantilla combina sexo '${raw.sex}' con categoría '${raw.category_code}'`).toBe(
          Sex.parse(raw.sex),
        );
    }
  });

  it('la planilla usa encabezados que el auto-mapeo reconoce', async () => {
    // Si los encabezados de nuestra propia plantilla no se auto-mapearan, el productor tendría que
    // asignar a mano las columnas de un archivo que le dimos nosotros.
    const t = await imports.templateRows('animal');
    const campos = await imports.listFields('animal');
    for (const h of t.headers) {
      const dueño = campos.find((c) => c.synonyms.includes(h));
      expect(dueño, `la plantilla titula una columna '${h}' que el servidor no reconoce`).toBeTruthy();
    }
  });

  it('la planilla trae las tres obligatorias y no inventa datos en las opcionales', async () => {
    // Una plantilla con un lote o una raza puestos por nosotros crea ese lote y esa raza el día que
    // alguien la sube tal cual — que es lo que hace medio mundo con una plantilla de ejemplo.
    const t = await imports.templateRows('animal');
    const campos = await imports.listFields('animal');
    const obligatorias = campos.filter((c) => c.required);
    for (const o of obligatorias)
      expect(t.headers.some((h) => o.synonyms.includes(h)), `la plantilla no trae la columna obligatoria ${o.label}`).toBe(true);

    for (const opcional of ['raza', 'lote']) {
      const i = t.headers.indexOf(opcional);
      if (i === -1) continue;
      for (const fila of t.rows) expect(fila[i], `la plantilla inventa un valor en '${opcional}'`).toBe('');
    }
  });

  it('otra entidad no tiene plantilla: se rechaza en vez de devolver algo vacío', async () => {
    await expect(imports.templateRows('vaca')).rejects.toMatchObject({ status: 400 });
    await expect(imports.listFields('vaca')).rejects.toMatchObject({ status: 400 });
  });
});
