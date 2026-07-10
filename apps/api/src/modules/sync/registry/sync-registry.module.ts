import { Global, Module } from '@nestjs/common';
import { SyncHandlerRegistry } from './sync-handler.registry';
import { SyncConflictWriter } from './sync-conflict.writer';

/**
 * Infraestructura transversal de sync (ADR-0008), disponible en cualquier
 * módulo sin imports cruzados — mismo patrón que `DbModule` (@Global, ya
 * usado en este codebase). Los handlers de dominio inyectan
 * `SyncHandlerRegistry` directamente (clase concreta, sin token: un solo
 * proveedor posible) y se auto-registran vía `OnModuleInit`.
 *
 * Se importa UNA sola vez, en AppModule, junto a DbModule.
 */
@Global()
@Module({
  providers: [SyncHandlerRegistry, SyncConflictWriter],
  exports: [SyncHandlerRegistry, SyncConflictWriter],
})
export class SyncRegistryModule {}
