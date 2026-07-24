/**
 * Puerto de salida de la capa de aplicación (mismo patrón que `EmailSender`, ADR-0011, y que
 * `EventPublisher`, ADR-0005): "guardá / traeme estos bytes". Los servicios que manejan archivos
 * —fotos de animales (media) y documentos formales (A6)— dependen SOLO de esta interfaz.
 *
 * POR QUÉ EXISTE: los dos escribían con `writeFileSync` contra el disco del proceso. Eso funciona
 * con una instancia y un disco persistente, y falla de dos formas silenciosas en cuanto no lo son:
 * la foto que sube una instancia no la sirve la otra, y un contenedor efímero se lleva todo en el
 * próximo deploy. La regla de negocio (dedup por checksum, token firmado) no cambia; lo que cambia
 * es DÓNDE viven los bytes.
 */
export const FILE_STORAGE = Symbol('FILE_STORAGE');

export interface FileStorage {
  /** Nombre del adaptador, para el log de arranque. */
  readonly kind: string;
  /** Guarda (o sobrescribe) el objeto. La clave es `<tenant_id>/<file_id>`. */
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  /** Devuelve los bytes, o `null` si la clave no existe. */
  get(key: string): Promise<Buffer | null>;
}

/** Clave canónica de un archivo. Una sola forma de armarla, en un solo lugar. */
export function fileKey(tenantId: string, fileId: string): string {
  return `${tenantId}/${fileId}`;
}
