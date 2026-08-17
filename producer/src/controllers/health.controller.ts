/* eslint-disable @typescript-eslint/no-unsafe-return */
import { Controller, Get } from '@nestjs/common';
import { OutboxMetricsService } from '../services/outbox/outbox-metrics.service';

@Controller('health')
export class HealthController {
  constructor(private readonly outboxMetrics: OutboxMetricsService) {}

  /**
   * GET /api/health/outbox
   *
   * Snapshot rápido de la salud del outbox:
   *   - pending:             filas todavía por publicar.
   *   - failed:              filas que agotaron reintentos.
   *   - oldest_pending_secs: antigüedad (segundos) del `pending` más viejo.
   *
   * Útil para dashboards / alertas: si `oldest_pending_secs` crece sin
   * bajar, el relay está atascado.
   */
  @Get('outbox')
  async outbox() {
    return this.outboxMetrics.snapshot();
  }
}
