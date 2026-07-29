import { ConflictException } from '@nestjs/common';
import { DbService, Q } from '../db/db.service';

/**
 * Dos cosas de la finca no pueden llamarse igual.
 *
 * **Por qué importa.** En el campo el lote y el potrero se nombran en voz alta —«llevá el rodeo al
 * Norte», «pasá los de Recría»— y en la app aparecen en cada selector de destino. Dos renglones
 * idénticos no se distinguen: mover animales al equivocado no deja ninguna señal, y el error solo se
 * descubre cuando faltan cabezas donde tendrían que estar.
 *
 * **Por qué vive acá y no en cada servicio.** Los lotes se crean por DOS puertas —el alta y la
 * división de un lote— que están en módulos distintos, y los potreros por una tercera. No se pueden
 * pasar la regla por inyección: `herd` ya depende de `land` (el alta de un animal lo ubica por la
 * regla única de movimientos), así que la dependencia inversa cerraría un ciclo. Un lugar neutral es
 * lo que permite que la regla exista una sola vez.
 *
 * **Por qué no un índice único.** Sería más fuerte —lo impondría el motor— pero un índice se aplica
 * al arrancar, y fallaría sobre cualquier finca que YA tenga nombres repetidos: abortaría el arranque
 * de un despliegue andando. Limpiar esos datos es un paso aparte, y no algo que deba decidir una
 * migración. Cuando ese paso esté hecho, el índice es la mejora natural de esto.
 */

/** Tablas con nombre único por tenant. Cerrado a propósito: el nombre entra en el SQL. */
type TablaConNombre = 'lots' | 'paddocks';

const ETIQUETA: Record<TablaConNombre, string> = { lots: 'lote', paddocks: 'potrero' };

/**
 * Falla si ya hay otra fila viva del tenant con ese nombre.
 *
 * Se compara sin mayúsculas ni espacios de sobra, que es exactamente como se repite un nombre por
 * error: nadie escribe dos veces «Rodeo Cría 1» clavado, escribe «rodeo cría 1» o le deja un espacio.
 *
 * `exceptId` permite editar una fila sin que choque consigo misma — sin eso, renombrar un lote
 * dejándole el nombre que ya tenía sería imposible.
 *
 * `q` opcional: dentro de una transacción hay que pasar el handle para que la comprobación vea lo
 * que esa misma transacción escribió.
 */
export async function assertUniqueName(
  db: DbService,
  table: TablaConNombre,
  name: string,
  exceptId?: string | null,
  q?: Q,
): Promise<void> {
  const sql = `SELECT id FROM ${table}
                WHERE tenant_id = $1 AND deleted_at IS NULL
                  AND lower(trim(name)) = lower(trim($2))
                  AND ($3::uuid IS NULL OR id <> $3)
                LIMIT 1`;
  const args = [db.tenant, name, exceptId ?? null];
  const repetido = q ? await q.one<{ id: string }>(sql, args) : await db.one<{ id: string }>(sql, args);
  if (repetido)
    throw new ConflictException({
      code: `${table === 'lots' ? 'lot' : 'paddock'}.duplicate_name`,
      title: `Ya hay un ${ETIQUETA[table]} llamado «${name.trim()}»`,
    });
}
