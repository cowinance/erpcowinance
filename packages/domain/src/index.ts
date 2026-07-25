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
// Servicios de dominio — nutrición: composición de raciones (N-1).
export * from './nutrition';
// Servicios de dominio — RRHH: totales de liquidación de sueldos (H-2).
export * from './hr';
// Servicios de dominio — producción: rendimiento de faena (FA-1).
export * from './production';
// Servicios de dominio — tierra: métricas de pastoreo (PG-1).
export * from './land';
// Configuración — validación de catálogos maestros (A3).
export * from './config';
// Documentos — validación del DMS formal (A6).
export * from './documents';
// Geo — geometría de potreros: validación de polígono y superficie (D3).
export * from './geo';
// Hato — lotes/rodeos: validación de grupo de manejo (B1).
export * from './herd';
// Costos — costo unitario por actividad, regla única de división (G2).
export * from './costing';
// Clima — índices agroclimáticos: grados-día, THI/estrés calórico, balance hídrico (D4).
export * from './weather';
// CRM — pipeline comercial y vigencia de contratos (F3).
export * from './crm';
