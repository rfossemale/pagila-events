/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SagaReplyQueueService } from '../queues/saga-reply-queue.service';

export interface SagaCommand {
  sagaId: string;
  step: string;
  command: string;
  phase: 'forward' | 'compensation';
  payload: Record<string, unknown>;
}

/**
 * Handler de comandos de saga.
 *  - ReserveStock  (forward)      → decrementa stock; rechaza si <= 0.
 *  - ReleaseStock  (compensation) → incrementa stock.
 *
 * Cada handler responde por `saga-replies` con un jobId estable por
 * fase para que BullMQ dedupe reintentos.
 */
@Injectable()
export class SagaCommandHandlerService {
  private readonly logger = new Logger(SagaCommandHandlerService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly replyQueue: SagaReplyQueueService,
  ) {}

  async handle(cmd: SagaCommand): Promise<void> {
    switch (cmd.command) {
      case 'ReserveStock':
        return this.reserveStock(cmd);
      case 'ReleaseStock':
        return this.releaseStock(cmd);
      default:
        this.logger.warn(`comando desconocido: ${cmd.command}`);
    }
  }

  // ─── forward ──────────────────────────────────────────────────────────

  private async reserveStock(cmd: SagaCommand): Promise<void> {
    const filmId = cmd.payload.filmId as number;
    const storeId = cmd.payload.storeId as number;

    const reserved = await this.dataSource.transaction(async (em) => {
      const rows = await em.query(
        `SELECT available FROM consumer.inventory_availability
          WHERE film_id = $1 AND store_id = $2
          FOR UPDATE`,
        [filmId, storeId],
      );
      if (rows.length === 0 || rows[0].available <= 0) return false;

      await em.query(
        `UPDATE consumer.inventory_availability
            SET available = available - 1
          WHERE film_id = $1 AND store_id = $2`,
        [filmId, storeId],
      );
      return true;
    });

    if (reserved) {
      this.logger.log(
        `saga ${cmd.sagaId} ← ReserveStock ok (film=${filmId}, store=${storeId})`,
      );
      await this.replyQueue.add(
        'StockReserved',
        {
          sagaId: cmd.sagaId,
          step: cmd.step,
          result: 'confirmed',
        },
        { jobId: `${cmd.sagaId}:${cmd.step}:forward-reply` },
      );
    } else {
      this.logger.warn(
        `saga ${cmd.sagaId} ← ReserveStock rechazado (film=${filmId}, store=${storeId}, sin stock)`,
      );
      await this.replyQueue.add(
        'StockRejected',
        {
          sagaId: cmd.sagaId,
          step: cmd.step,
          result: 'rejected',
          error: `no hay stock para film=${filmId} store=${storeId}`,
        },
        { jobId: `${cmd.sagaId}:${cmd.step}:forward-reply` },
      );
    }
  }

  // ─── compensation ─────────────────────────────────────────────────────

  private async releaseStock(cmd: SagaCommand): Promise<void> {
    const filmId = cmd.payload.filmId as number;
    const storeId = cmd.payload.storeId as number;

    await this.dataSource.query(
      `UPDATE consumer.inventory_availability
          SET available = available + 1
        WHERE film_id = $1 AND store_id = $2`,
      [filmId, storeId],
    );

    this.logger.log(
      `saga ${cmd.sagaId} ↩ ReleaseStock ok (film=${filmId}, store=${storeId})`,
    );

    await this.replyQueue.add(
      'StockReleased',
      {
        sagaId: cmd.sagaId,
        step: cmd.step,
        result: 'confirmed',
      },
      { jobId: `${cmd.sagaId}:${cmd.step}:comp-reply` },
    );
  }
}
