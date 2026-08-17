import { Injectable } from '@nestjs/common';
import {
  Counter,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from 'prom-client';

/**
 * Registro central de métricas Prometheus del `consumer`.
 *
 * Además de las métricas por defecto de Node y las de HTTP (vía interceptor),
 * expone `consumer_events_total`, un contador de eventos aplicados por el
 * `EventProcessorService`, etiquetado por tipo de evento y resultado
 * (`applied` | `duplicate` | `stale`). Ese contador es el corazón del
 * dashboard: muestra el throughput real del pipeline y cuántos duplicados /
 * eventos viejos se descartan.
 */
@Injectable()
export class MetricsService {
  readonly registry = new Registry();
  readonly httpRequestsTotal: Counter<string>;
  readonly httpRequestDuration: Histogram<string>;
  readonly eventsTotal: Counter<string>;

  constructor() {
    this.registry.setDefaultLabels({ app: 'consumer' });
    collectDefaultMetrics({ register: this.registry });

    this.httpRequestsTotal = new Counter({
      name: 'http_requests_total',
      help: 'Total de requests HTTP procesadas',
      labelNames: ['method', 'route', 'status'],
      registers: [this.registry],
    });

    this.httpRequestDuration = new Histogram({
      name: 'http_request_duration_seconds',
      help: 'Duración de las requests HTTP en segundos',
      labelNames: ['method', 'route', 'status'],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
      registers: [this.registry],
    });

    this.eventsTotal = new Counter({
      name: 'consumer_events_total',
      help: 'Eventos procesados por el consumer',
      labelNames: ['event_type', 'result'],
      registers: [this.registry],
    });
  }

  /** Registra el resultado de procesar un evento del dominio. */
  recordEvent(
    eventType: string,
    result: 'applied' | 'duplicate' | 'stale',
  ): void {
    this.eventsTotal.inc({ event_type: eventType, result });
  }

  observeHttp(method: string, route: string, status: string, seconds: number) {
    const labels = { method, route, status };
    this.httpRequestsTotal.inc(labels);
    this.httpRequestDuration.observe(labels, seconds);
  }

  get contentType(): string {
    return this.registry.contentType;
  }

  metrics(): Promise<string> {
    return this.registry.metrics();
  }
}
