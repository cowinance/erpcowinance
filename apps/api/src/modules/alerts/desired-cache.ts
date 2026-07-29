/**
 * La caché del estado deseado del motor de alertas.
 *
 * **Qué se estaba pagando.** `computeDesired()` es lo caro del módulo: recorre el hato y corre
 * `computeReproStatus`, O(vientres). Se ejecutaba DOS VECES en cada carga del Inicio —una para la
 * agenda y los KPIs, otra para el badge de notificaciones del encabezado, que pasa por `dispatch()`—
 * y como el encabezado vive en el layout, esa segunda corría además en CADA pantalla de la app.
 * Medido sobre 65 animales: 40-60 ms por corrida, y el costo crece con el hato.
 *
 * **Por qué se puede cachear sin mentir.** La invalidación NO es por tiempo, es por ESCRITURA: la
 * generación del tenant sube en cuanto una sentencia cambia filas, y quien lo dice es el motor
 * (`affectedRows`), no una heurística por método HTTP — que en este sistema habría fallado, porque
 * varios `GET` escriben. Así, completar una tarea y recargar muestra el resultado nuevo.
 *
 * Una caché puramente por tiempo mostraría la alerta que el productor acaba de resolver, que es
 * exactamente el momento en que mira.
 *
 * Se guarda por tenant y en memoria del proceso: es un cálculo derivado, se rehace solo.
 */

/** Lo que el motor calculó la última vez, con la generación de escritura en la que se calculó. */
interface Entrada<T> {
  gen: number;
  at: number;
  valor: T;
}

/**
 * Cuánto puede vivir un cálculo aunque nadie haya escrito EN ESTE PROCESO.
 *
 * La corrección no depende de este número: la lleva la generación de escritura. El TTL cubre un solo
 * caso — el día que el despliegue pase a varias instancias, una escritura en la A no subiría el
 * contador de la B. Hoy `pm2` corre una sola (`cowinance-api`), así que este techo es un seguro y no
 * el mecanismo.
 *
 * Treinta segundos: corto frente a lo que tarda alguien en leer una pantalla, y largo frente a los
 * ~50 ms que separan las dos consultas de una misma carga, que es lo que se quiere juntar.
 */
export const DESIRED_TTL_MS = 30_000;

/**
 * Lo que la caché necesita saber de la base. Se pide así, y no `DbService` entero, para que este
 * archivo se pueda probar sin levantar nada.
 */
export interface FuenteDeGeneracion {
  readonly tenant: string | null;
  writeGeneration(): number;
  /** ¿La request en curso ya escribió? */
  hasWritten(): boolean;
}

export class DesiredCache<T> {
  private readonly datos = new Map<string, Entrada<T>>();

  constructor(private readonly ttlMs = DESIRED_TTL_MS) {}

  /**
   * Devuelve lo cacheado si sigue valiendo; si no, calcula y guarda.
   *
   * Quien ya escribió en ESTA request queda afuera de las dos puntas: la generación sube al momento,
   * pero lo suyo todavía no está confirmado. No puede usar una foto anterior a su escritura — ni
   * dejar una hecha sobre datos que todavía puede deshacer, que otro request leería como si fuera
   * la finca.
   */
  async through(db: FuenteDeGeneracion, calcular: () => Promise<T>, ahora = Date.now()): Promise<T> {
    const tenant = db.tenant;
    if (db.hasWritten() || !tenant) return calcular();

    const gen = db.writeGeneration();
    const e = this.datos.get(tenant);
    if (e && e.gen === gen && ahora - e.at < this.ttlMs) return e.valor;

    const valor = await calcular();
    this.datos.set(tenant, { gen, at: ahora, valor });
    return valor;
  }
}
