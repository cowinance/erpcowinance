/**
 * Base de todos los errores de dominio. Los errores específicos
 * (InvalidIdentifier ahora; DuplicateTag, InvalidWeight, … en F3) la extienden.
 * `code` es el identificador estable que la capa HTTP mapea a la respuesta
 * (RFC 9457), independiente del texto del mensaje.
 *
 * Se introduce el mínimo indispensable en F2 porque los Value Objects necesitan
 * rechazar entradas inválidas con un error del dominio (no uno genérico). La
 * jerarquía completa se construye en F3.
 */
export abstract class DomainError extends Error {
  abstract readonly code: string;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}
