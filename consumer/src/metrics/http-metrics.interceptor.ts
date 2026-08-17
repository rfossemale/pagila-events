import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, finalize } from 'rxjs';
import type { Request, Response } from 'express';
import { MetricsService } from './metrics.service';

/**
 * Interceptor global que mide cada request HTTP y la registra en Prometheus.
 * Usa el patrón de ruta de Nest como label para evitar alta cardinalidad.
 */
@Injectable()
export class HttpMetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const http = context.switchToHttp();
    const req = http.getRequest<Request & { route?: { path?: string } }>();
    const res = http.getResponse<Response>();
    const method = req.method;
    const start = process.hrtime.bigint();

    return next.handle().pipe(
      finalize(() => {
        const route = req.route?.path ?? req.path ?? 'unknown';
        const seconds = Number(process.hrtime.bigint() - start) / 1e9;
        this.metrics.observeHttp(method, route, String(res.statusCode), seconds);
      }),
    );
  }
}
