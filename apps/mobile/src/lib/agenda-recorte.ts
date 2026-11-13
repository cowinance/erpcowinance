/**
 * Recorte de la agenda del inicio.
 *
 * La agenda del día puede traer decenas de ítems —en una finca de 66 animales se vieron 59— y el
 * inicio los mostraba todos. El resultado era una pantalla sin fondo: para llegar al botón de
 * manga, que es la acción principal del día, había que pasar cincuenta y pico de líneas.
 *
 * **El recorte es por PRESUPUESTO TOTAL y respeta el orden de urgencia**, no un tope por grupo.
 * Esa es la parte que importa: con un tope por grupo, tres vencidos y cincuenta y seis próximos
 * darían diez de cada uno y los vencidos quedarían diluidos. Acá los grupos se llenan en orden
 * —Vencidos, Hoy, Próximos— así que lo urgente entra siempre y lo que se esconde es la cola.
 */
export interface GrupoDeAgenda<T> {
  key: string;
  label: string;
  list: T[];
}

export interface AgendaRecortada<T> {
  grupos: GrupoDeAgenda<T>[];
  /** Cuántos quedaron fuera. Cero significa que se muestran todos. */
  ocultos: number;
  /** Total de ítems antes del recorte, para el texto del botón. */
  total: number;
}

export function recortarAgenda<T>(grupos: GrupoDeAgenda<T>[], limite: number): AgendaRecortada<T> {
  const total = grupos.reduce((n, g) => n + g.list.length, 0);
  if (limite <= 0 || total <= limite) return { grupos, ocultos: 0, total };

  let presupuesto = limite;
  const recortados: GrupoDeAgenda<T>[] = [];
  for (const g of grupos) {
    if (presupuesto <= 0) break; // los grupos enteros que no entran NO se dibujan vacíos
    const list = g.list.slice(0, presupuesto);
    presupuesto -= list.length;
    recortados.push({ ...g, list });
  }
  return { grupos: recortados, ocultos: total - limite, total };
}
