declare const brand: unique symbol;

/**
 * Marca nominal para tipos primitivos — el ÚNICO primitivo del Shared Kernel
 * en F1. Permite tipos como `AnimalId = Brand<string, 'AnimalId'>` que no son
 * intercambiables entre sí ni con `string`, sin costo en runtime (es sólo un
 * tipo; el valor sigue siendo el primitivo subyacente).
 *
 * Los Value Objects concretos (AnimalId, FarmId, TenantId, …) se construyen
 * sobre esta marca en F2. Se ubica en `shared/` porque las identidades cruzan
 * todos los bounded contexts.
 */
export type Brand<T, K extends string> = T & { readonly [brand]: K };
