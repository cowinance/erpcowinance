import type { Brand } from '../shared/brand';
import { makeIdentifier } from './identifier';

/**
 * Identidades del dominio (F2.1). Cada una es un UUID (garantía de validez) y un
 * tipo nominalmente distinto (garantía de no confundir uno con otro en tiempo de
 * compilación). Patrón "companion": el mismo nombre es el tipo y su factory.
 *
 *   const id = AnimalId.of(row.id);   // valida
 *   funcion(id);                      // no acepta un FarmId acá
 */

export type TenantId = Brand<string, 'TenantId'>;
export const TenantId = makeIdentifier<'TenantId'>('TenantId');

export type FarmId = Brand<string, 'FarmId'>;
export const FarmId = makeIdentifier<'FarmId'>('FarmId');

export type AnimalId = Brand<string, 'AnimalId'>;
export const AnimalId = makeIdentifier<'AnimalId'>('AnimalId');

export type LotId = Brand<string, 'LotId'>;
export const LotId = makeIdentifier<'LotId'>('LotId');
