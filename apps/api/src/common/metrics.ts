/**
 * Registro de métricas en memoria, con salida en el formato de texto de Prometheus.
 *
 * POR QUÉ A MANO: `prom-client` arrastra dependencias para lo que acá son dos contadores y un
 * histograma, y el formato de exposición es texto plano documentado. Mismo criterio que el rate
 * limit y las cabeceras de seguridad.
 *
 * CARDINALIDAD: la etiqueta de ruta es `Controlador.handler`, NO la URL. Una URL trae ids
 * (`/animals/9af0…`) y cada uno crearía una serie nueva: en una finca con 10.000 animales, el
 * registro de métricas terminaría pesando más que los datos. El nombre del handler está acotado
 * por el código.
 */
export interface MetricSample {
  route: string;
  method: string;
  status: number;
  durationMs: number;
}

/** Cortes en milisegundos. Elegidos alrededor de lo que ya se midió: home() ~110 ms. */
const BUCKETS_MS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000];

interface RouteStats {
  count: number;
  errors: number;
  totalMs: number;
  buckets: number[];
}

export class MetricsRegistry {
  private readonly routes = new Map<string, RouteStats>();
  private readonly statuses = new Map<number, number>();

  observe(sample: MetricSample): void {
    const key = `${sample.method} ${sample.route}`;
    const stats = this.routes.get(key) ?? { count: 0, errors: 0, totalMs: 0, buckets: BUCKETS_MS.map(() => 0) };
    stats.count++;
    stats.totalMs += sample.durationMs;
    if (sample.status >= 500) stats.errors++;
    // Histograma acumulativo: cada bucket cuenta las observaciones ≤ su cota (le/…), como pide
    // el formato de Prometheus.
    BUCKETS_MS.forEach((cota, i) => {
      if (sample.durationMs <= cota) stats.buckets[i]++;
    });
    this.routes.set(key, stats);
    this.statuses.set(sample.status, (this.statuses.get(sample.status) ?? 0) + 1);
  }

  /** Formato de exposición de Prometheus (texto plano). */
  render(now: { uptimeS: number; heapUsedBytes: number; rssBytes: number }): string {
    const lineas: string[] = [];

    lineas.push('# HELP cowinance_http_requests_total Requests HTTP atendidas.');
    lineas.push('# TYPE cowinance_http_requests_total counter');
    for (const [key, stats] of [...this.routes].sort()) {
      const [method, route] = key.split(' ');
      lineas.push(`cowinance_http_requests_total{method="${method}",route="${route}"} ${stats.count}`);
    }

    lineas.push('# HELP cowinance_http_errors_total Respuestas 5xx (fallas del servidor, no del cliente).');
    lineas.push('# TYPE cowinance_http_errors_total counter');
    for (const [key, stats] of [...this.routes].sort()) {
      const [method, route] = key.split(' ');
      lineas.push(`cowinance_http_errors_total{method="${method}",route="${route}"} ${stats.errors}`);
    }

    lineas.push('# HELP cowinance_http_responses_total Respuestas por código de estado.');
    lineas.push('# TYPE cowinance_http_responses_total counter');
    for (const [status, n] of [...this.statuses].sort((a, b) => a[0] - b[0])) {
      lineas.push(`cowinance_http_responses_total{status="${status}"} ${n}`);
    }

    lineas.push('# HELP cowinance_http_duration_ms Latencia por ruta.');
    lineas.push('# TYPE cowinance_http_duration_ms histogram');
    for (const [key, stats] of [...this.routes].sort()) {
      const [method, route] = key.split(' ');
      const etiquetas = `method="${method}",route="${route}"`;
      BUCKETS_MS.forEach((cota, i) => {
        lineas.push(`cowinance_http_duration_ms_bucket{${etiquetas},le="${cota}"} ${stats.buckets[i]}`);
      });
      lineas.push(`cowinance_http_duration_ms_bucket{${etiquetas},le="+Inf"} ${stats.count}`);
      lineas.push(`cowinance_http_duration_ms_sum{${etiquetas}} ${stats.totalMs.toFixed(1)}`);
      lineas.push(`cowinance_http_duration_ms_count{${etiquetas}} ${stats.count}`);
    }

    lineas.push('# HELP cowinance_process_uptime_seconds Segundos desde el arranque.');
    lineas.push('# TYPE cowinance_process_uptime_seconds gauge');
    lineas.push(`cowinance_process_uptime_seconds ${now.uptimeS}`);
    lineas.push('# HELP cowinance_process_heap_used_bytes Heap de V8 en uso.');
    lineas.push('# TYPE cowinance_process_heap_used_bytes gauge');
    lineas.push(`cowinance_process_heap_used_bytes ${now.heapUsedBytes}`);
    lineas.push('# HELP cowinance_process_resident_bytes Memoria residente del proceso.');
    lineas.push('# TYPE cowinance_process_resident_bytes gauge');
    lineas.push(`cowinance_process_resident_bytes ${now.rssBytes}`);

    return lineas.join('\n') + '\n';
  }

  /** Solo para tests. */
  get routeCount(): number {
    return this.routes.size;
  }
}

/** Una sola instancia por proceso: las métricas son estado del proceso, no de una request. */
export const metrics = new MetricsRegistry();
