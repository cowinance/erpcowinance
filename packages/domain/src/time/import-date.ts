/**
 * La fecha que viene en una planilla.
 *
 * **Por qué hace falta.** El importador no interpretaba fechas: le pasaba el texto de la celda
 * directo a PostgreSQL. Lo que el motor entendía entraba, y lo demás reventaba el `INSERT` — y como
 * el chunk es todo-o-nada, UNA celda mala en 3.000 filas mataba la importación entera. Medido contra
 * la app, con una planilla como la que manda cualquier productor de acá:
 *
 *  · `14/03/2022` → el lote quedaba trabado, reintentando cada dos minutos para siempre
 *  · `05/06/2022` → se guardaba como **6 de mayo**: el productor escribió 5 de junio
 *  · `marzo 2022` → la vista previa decía «válida» y después reventaba
 *
 * **Día/mes, no mes/día.** Es la decisión que cambia datos. Al pasarle el texto crudo a Postgres,
 * `05/06/2022` se leía a la manera estadounidense —mes primero— y quedaba 6 de mayo en vez de 5 de
 * junio. En Venezuela, Argentina y España se escribe día primero, así que la lectura de antes estaba
 * equivocada para todos los productores del sistema, y en silencio: un mes de diferencia no chilla,
 * pero corre la edad, la ventana de destete y la categoría por edad.
 *
 * Cuando el día es mayor que 12 no hay ambigüedad y las dos convenciones coinciden en el resultado;
 * la elección solo importa del 1 al 12, que es un tercio de las fechas.
 *
 * **Lo que NO se adivina.** Un número pelado (`44634`) es una fecha de Excel sin formatear, y
 * traducirlo sería tentador: es una función de una línea. No se hace, porque «2022» también es un
 * número pelado y se convertiría en 1975 sin que nadie se entere. Ante un número, se pide que
 * formateen la columna — un rechazo que se entiende es mejor que un dato callado que está mal.
 *
 * Puro, sin relojes ni IO: el «hoy» entra por parámetro.
 */

export interface ImportDateOk {
  readonly ok: true;
  /** Fecha calendario `YYYY-MM-DD`, o `null` si la celda venía vacía (que es válido). */
  readonly date: string | null;
}
export interface ImportDateFail {
  readonly ok: false;
  /** Qué pasa con esta celda, escrito para quien está mirando su planilla. */
  readonly reason: string;
}
export type ImportDateResult = ImportDateOk | ImportDateFail;

const ISO = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
const CON_BARRAS = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2}|\d{4})$/;
const SOLO_NUMEROS = /^\d+$/;

const MESES = ['', 'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** Año de dos dígitos → siglo. 22 es 2022; 95 es 1995. Ningún animal vivo nació antes del 70. */
function siglo(aa: number): number {
  return aa < 70 ? 2000 + aa : 1900 + aa;
}

const dosDigitos = (n: number): string => String(n).padStart(2, '0');

/** ¿Existe ese día en ese mes de ese año? Atrapa el 31 de abril y el 29 de febrero de un año común. */
function esFechaReal(a: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const f = new Date(Date.UTC(a, m - 1, d));
  return f.getUTCFullYear() === a && f.getUTCMonth() === m - 1 && f.getUTCDate() === d;
}

/**
 * Interpreta la celda y devuelve la fecha calendario, o explica por qué no puede.
 *
 * `hoy` es la fecha de la FINCA (`YYYY-MM-DD`): una fecha de nacimiento futura se rechaza acá y no
 * en la base, para que aparezca en la vista previa —donde el productor todavía puede arreglar la
 * planilla— y no al medio de un commit de 3.000 filas.
 */
export function parseImportDate(value: unknown, hoy: string): ImportDateResult {
  if (value == null) return { ok: true, date: null };
  const texto = String(value).trim();
  if (texto === '') return { ok: true, date: null };

  let anio: number;
  let mes: number;
  let dia: number;

  const iso = ISO.exec(texto);
  const barras = CON_BARRAS.exec(texto);

  if (iso) {
    anio = Number(iso[1]);
    mes = Number(iso[2]);
    dia = Number(iso[3]);
  } else if (barras) {
    // DÍA primero. Ver el porqué en el encabezado: es la convención de donde se usa esta app.
    dia = Number(barras[1]);
    mes = Number(barras[2]);
    const aa = barras[3];
    anio = aa.length === 2 ? siglo(Number(aa)) : Number(aa);

    // Un «mes» mayor que 12 con un «día» que sí podría ser mes: la planilla vino al revés, en
    // mes/día. Se nombra el problema en vez de contestar «fecha inválida», porque así el productor
    // sabe que tiene que arreglar la COLUMNA entera y no esa celda.
    if (mes > 12 && dia <= 12) {
      // Los dos números están cambiados de lugar respecto de lo que quiso escribir.
      const diaReal = mes;
      const mesReal = dia;
      return {
        ok: false,
        reason: `«${texto}» parece estar en formato mes/día. Acá las fechas van día/mes: si quisiste decir el ${diaReal} de ${MESES[mesReal]}, escribilo ${dosDigitos(diaReal)}/${dosDigitos(mesReal)}/${anio}.`,
      };
    }
  } else if (SOLO_NUMEROS.test(texto)) {
    // Número pelado: casi siempre una fecha de Excel sin formatear. No se adivina — ver encabezado.
    return {
      ok: false,
      reason: `«${texto}» es un número, no una fecha. Suele pasar cuando Excel exporta la columna sin formato: dale formato de fecha o escribila como ${hoy}.`,
    };
  } else {
    return { ok: false, reason: `«${texto}» no es una fecha. Escribila como ${hoy} o como día/mes/año.` };
  }

  if (!esFechaReal(anio, mes, dia)) return { ok: false, reason: `«${texto}» no es una fecha que exista.` };

  const fecha = `${anio}-${dosDigitos(mes)}-${dosDigitos(dia)}`;
  if (fecha > hoy)
    return { ok: false, reason: `«${texto}» es una fecha futura (hoy es ${hoy}). Un animal no puede haber nacido todavía.` };

  return { ok: true, date: fecha };
}
