// Punto de entrada público del dominio puro de Cowinance.
// Shared Kernel: marca nominal + base de errores de dominio.
export type { Brand } from './shared';
export { DomainError } from './shared';
// Value Objects de identidad (F2.1).
export * from './value-objects';
// Servicios de dominio — sanidad (F4.1).
export * from './health';
// Servicios de dominio — reproducción (F4.2).
export * from './reproduction';
// Contratos de eventos de dominio (F5, ADR-0005).
export * from './events';
// Servicios de dominio — comercial: totales de documentos (C-2/C-3).
export * from './commerce';
// Servicios de dominio — finanzas: partida doble balanceada (F-1/F-2).
export * from './finance';
