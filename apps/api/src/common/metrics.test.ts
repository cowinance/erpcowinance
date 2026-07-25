import { describe, it, expect } from 'vitest';
import { MetricsRegistry } from './metrics';

const AHORA = { uptimeS: 42, heapUsedBytes: 1000, rssBytes: 2000 };
const linea = (salida: string, prefijo: string) => salida.split('\n').filter((l) => l.startsWith(prefijo));

describe('MetricsRegistry', () => {
  it('cuenta las requests por método y ruta', () => {
    const r = new MetricsRegistry();
    r.observe({ route: 'HerdController.list', method: 'GET', status: 200, durationMs: 12 });
    r.observe({ route: 'HerdController.list', method: 'GET', status: 200, durationMs: 20 });
    r.observe({ route: 'HerdController.create', method: 'POST', status: 201, durationMs: 30 });

    const out = r.render(AHORA);
    expect(out).toContain('cowinance_http_requests_total{method="GET",route="HerdController.list"} 2');
    expect(out).toContain('cowinance_http_requests_total{method="POST",route="HerdController.create"} 1');
  });

  // 5xx es una falla NUESTRA; 4xx es el cliente pidiendo mal. Mezclarlos haría que un puñado de
  // 401 normales dispare las mismas alarmas que una caída real.
  it('solo cuenta como error los 5xx', () => {
    const r = new MetricsRegistry();
    for (const status of [200, 401, 404, 422]) r.observe({ route: 'C.h', method: 'GET', status, durationMs: 1 });
    r.observe({ route: 'C.h', method: 'GET', status: 500, durationMs: 1 });
    r.observe({ route: 'C.h', method: 'GET', status: 503, durationMs: 1 });

    expect(r.render(AHORA)).toContain('cowinance_http_errors_total{method="GET",route="C.h"} 2');
  });

  it('agrega las respuestas por código de estado', () => {
    const r = new MetricsRegistry();
    r.observe({ route: 'A.a', method: 'GET', status: 200, durationMs: 1 });
    r.observe({ route: 'B.b', method: 'POST', status: 200, durationMs: 1 });
    r.observe({ route: 'A.a', method: 'GET', status: 401, durationMs: 1 });

    const out = r.render(AHORA);
    expect(out).toContain('cowinance_http_responses_total{status="200"} 2');
    expect(out).toContain('cowinance_http_responses_total{status="401"} 1');
  });

  // El histograma de Prometheus es ACUMULATIVO: cada bucket cuenta todo lo ≤ su cota.
  it('el histograma acumula hacia arriba y cierra en +Inf', () => {
    const r = new MetricsRegistry();
    for (const durationMs of [3, 30, 300]) r.observe({ route: 'C.h', method: 'GET', status: 200, durationMs });

    const buckets = linea(r.render(AHORA), 'cowinance_http_duration_ms_bucket');
    const valor = (le: string) => Number(buckets.find((l) => l.includes(`le="${le}"`))!.split(' ').pop());
    expect(valor('5')).toBe(1); // 3
    expect(valor('50')).toBe(2); // 3, 30
    expect(valor('500')).toBe(3); // 3, 30, 300
    expect(valor('+Inf')).toBe(3);

    const out = r.render(AHORA);
    expect(out).toContain('cowinance_http_duration_ms_sum{method="GET",route="C.h"} 333.0');
    expect(out).toContain('cowinance_http_duration_ms_count{method="GET",route="C.h"} 3');
  });

  // Lo que evita que el registro de métricas crezca sin control: la etiqueta es el handler, no la
  // URL. Con URLs, una finca de 10.000 animales generaría 10.000 series.
  it('la cardinalidad la fija el handler, no la cantidad de requests', () => {
    const r = new MetricsRegistry();
    for (let i = 0; i < 5000; i++)
      r.observe({ route: 'HerdController.findOne', method: 'GET', status: 200, durationMs: i % 100 });
    expect(r.routeCount).toBe(1);
  });

  it('expone métricas del proceso', () => {
    const out = new MetricsRegistry().render(AHORA);
    expect(out).toContain('cowinance_process_uptime_seconds 42');
    expect(out).toContain('cowinance_process_heap_used_bytes 1000');
    expect(out).toContain('cowinance_process_resident_bytes 2000');
  });

  it('cada métrica declara su HELP y su TYPE (o Prometheus la ignora)', () => {
    const out = new MetricsRegistry().render(AHORA);
    for (const m of [
      'cowinance_http_requests_total',
      'cowinance_http_errors_total',
      'cowinance_http_responses_total',
      'cowinance_http_duration_ms',
      'cowinance_process_uptime_seconds',
    ]) {
      expect(out).toContain(`# HELP ${m} `);
      expect(out).toContain(`# TYPE ${m} `);
    }
    expect(out.endsWith('\n')).toBe(true);
  });
});
