import { Controller, HttpCode, Post } from '@nestjs/common';
import { OutboxCleanup } from '../services/outbox/outbox-cleanup.service';

@Controller('outbox')
export class OutboxController {
  constructor(private readonly outboxCleanup: OutboxCleanup) {}

  /**
   * POST /api/outbox/purge
   *
   * Dispara manualmente la purga del outbox (mismo trabajo que corre el
   * cron `0 3 * * *`). Borra por lotes de 5000 las filas `published` con
   * más de 7 días.
   *
   * Útil para tests, backfills o para vaciar la tabla antes de un mantenimiento.
   * Responde con la cantidad total de filas eliminadas.
   */
  @Post('purge')
  @HttpCode(200)
  async purge(): Promise<{ deleted: number }> {
    return this.outboxCleanup.purge();
  }
}
