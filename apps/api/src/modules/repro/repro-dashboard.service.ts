import { Injectable } from '@nestjs/common';
import { ReproService } from './repro.service';
import { ReproStatusService } from './repro-status.service';
import { ProtocolService } from './protocol.service';

/**
 * El panel de reproducción: COMPONE, no calcula.
 *
 * Vivía dentro de `ReproService` y desde ahí llamaba a los protocolos, que ahora son su propio
 * servicio. Eso habría creado un ciclo —protocolos necesita a reproducción para registrar el
 * servicio de una IATF con la regla única—, y un ciclo es exactamente lo que el gate de
 * arquitectura no deja pasar.
 *
 * La salida es un compositor, el mismo patrón que ya usa el Inicio (`DashboardHomeService`): cada
 * número lo sigue calculando su dueño y acá solo se arman en una respuesta.
 */
@Injectable()
export class ReproDashboardService {
  constructor(
    private readonly repro: ReproService,
    private readonly status: ReproStatusService,
    private readonly protocols: ProtocolService,
  ) {}

  /**
   * Dashboard reproductivo operativo (E3): «qué tengo que hacer» en una sola llamada. COMPONE los
   * métodos existentes (KPIs, estado del rodeo, próximas a preparar, partos próximos, protocolos
   * activos) — sin duplicar reglas. El estado (diagnóstico pendiente / abiertas críticas) se deriva
   * de la regla única `computeReproStatus` vía `herdStatus`.
   */
  async reproDashboard() {
    const [kpis, herd, prepare, calvings, assignments] = await Promise.all([
      this.repro.kpis(),
      this.status.herdStatus(),
      this.status.toPrepare(14),
      this.repro.upcomingCalvings(30),
      this.protocols.listAssignments(),
    ]);
    const diagnosisPending = herd.rows.filter((r) => r.status === 'diagnosis_pending')
      .sort((a, b) => (b.days_since_service ?? 0) - (a.days_since_service ?? 0)).slice(0, 50);
    const criticalOpen = herd.rows.filter((r) => r.status === 'open' || r.status === 'repeat_breeder')
      .sort((a, b) => (b.days_open ?? 0) - (a.days_open ?? 0)).slice(0, 50);
    const activeProtocols = (assignments as any[]).filter((a) => a.status === 'active');
    return {
      kpis,
      counts: herd.counts,
      config: herd.config,
      diagnosis_pending: diagnosisPending,
      critical_open: criticalOpen,
      upcoming_calvings: calvings,
      to_prepare: prepare.rows,
      active_protocols: activeProtocols,
    };
  }
}
