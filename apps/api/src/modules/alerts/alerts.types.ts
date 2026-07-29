/**
 * Los dos tipos que cruzan el módulo de alertas.
 *
 * Viven aparte del servicio para que la proyección a agenda pueda importarlos sin importar el motor
 * entero: sin esto, `agenda-projection` y `alerts.service` se importaban mutuamente y quedaba un
 * ciclo. Son contratos, no lógica — el archivo no ejecuta nada.
 */

export interface Desired {
  code: string;
  category: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  message: string;
  related_type: string | null;
  related_id: string | null;
  /** Datos estructurados que la agenda (P4) reutiliza; `evaluate()` los ignora. */
  due_at?: string | null;
  tag?: string | null;
  /**
   * Clave de agrupación para alertas que son UN SOLO TRABAJO (misma tarea sanitaria, misma fecha).
   * `undefined` = no agrupa, que es lo correcto para todo lo único por entidad. La calcula quien
   * genera la alerta: parsear el título después se rompería en silencio al cambiar un texto.
   */
  group_key?: string | null;
  /**
   * Encabezado del grupo, SIN la entidad. El título individual lleva la caravana y usarlo para el
   * grupo daría «… — caravana 301 · 10 animales», que se lee como si fuera sobre ese animal.
   */
  group_title?: string | null;
}

/** Ítem de la agenda diaria (P4-1): hecho accionable estructurado del hato. */
export interface AgendaItemDto {
  code: string;
  category: string;
  severity: 'info' | 'warning' | 'critical';
  due_at: string | null;
  title: string;
  message: string;
  related_type: string | null;
  related_id: string | null;
  tag: string | null;
  /** Acción SEMÁNTICA; cada superficie la mapea a su ruta (móvil/web). */
  action: 'vaccinate' | 'review_pregnancy' | 'view_animal' | 'complete_task';
}

