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
  payload: Record<string, unknown>;
}

/**
 * Handler de comandos de saga. Cada comando conocido se ejecuta en su
 * propia transacción y produce una respuesta que se encola en
 * `saga-replies` para que el orquestador reanude la saga.
 *
 * Happy path: solo implementamos `ReserveStock`.
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
        await this.reserveStock(cmd);
        return;
      default:
        this.logger.warn(`comando desconocido: ${cmd.command}`);
    }
  }

  private async reserveStock(cmd: SagaCommand): Promise<void> {
    const filmId = cmd.payload.filmId as number;
    const storeId = cmd.payload.storeId as number;

    await this.dataSource.transaction(async (em) => {
      // Happy path: bajamos stock sin verificar; el input viene validado
      // por el step local previo. La rama con rechazo va con la compensación.
      await em.query(
        `UPDATE consumer.inventory_availability
            SET available = available - 1
          WHERE film_id = $1 AND store_id = $2`,
        [filmId, storeId],
      );
    });

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
      { jobId: `${cmd.sagaId}:${cmd.step}:reply` },
    );
  }
}
