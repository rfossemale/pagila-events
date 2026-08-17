import { Injectable } from '@nestjs/common';
import {
  Counter,
  Gauge,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from 'prom-client';
import { OutboxMetricsService } from '../services/outbox/outbox-metrics.service';

/**
 * Registro central de métricas Prometheus del `producer`.
 *
 * Expone tres familias:
 *   • Métricas por defecto de Node (CPU, memoria, GC, event loop lag).
 *   • Métricas HTTP (contador + histograma de latencia) alimentadas por el
 *     `HttpMetricsInterceptor`.
 *   • Gauges del outbox (backlog pendiente/fallido y antigüedad), refrescados
 *     en cada scrape mediante el callback `collect` del gauge `pending`.
 */
@Injectable()
export class MetricsService {
  readonly registry = new Registry();
  readonly httpRequestsTotal: Counter<string>;
  readonly httpRequestDuration: Histogram<string>;

  constructor(private readonly outboxMetrics: OutboxMetricsService) {
    this.registry.setDefaultLabels({ app: 'producer' });
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

    const failed = new Gauge({
      name: 'outbox_failed_total',
      help: 'Eventos del outbox que agotaron sus reintentos',
      registers: [this.registry],
    });
    const oldest = new Gauge({
      name: 'outbox_oldest_pending_seconds',
      help: 'Antigüedad (segundos) del evento pendiente más viejo',
      registers: [this.registry],
    });
    // Una sola consulta por scrape refresca los tres gauges del outbox.
    const pending = new Gauge({
      name: 'outbox_pending_total',
      help: 'Eventos del outbox pendientes de publicar',
      registers: [this.registry],
      collect: async () => {
        const snap = await this.outboxMetrics.snapshot();
        pending.set(snap.pending);
        failed.set(snap.failed);
        oldest.set(snap.oldest_pending_secs ?? 0);
      },
    });
  }

  /** Registra una observación HTTP (contador + histograma). */
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
