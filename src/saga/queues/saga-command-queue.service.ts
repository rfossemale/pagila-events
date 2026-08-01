import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { JobsOptions, Queue } from 'bullmq';

/**
 * Cola de comandos de saga (producer → consumer).
 * El orquestador publica acá cuando un step es `kind: 'remote'`.
 * Nombre del job = nombre del comando (ej: `ReserveStock`).
 */
@Injectable()
export class SagaCommandQueueService implements OnModuleDestroy {
  private readonly logger = new Logger(SagaCommandQueueService.name);
  static readonly QUEUE_NAME = 'saga-commands';

  private readonly queue: Queue;

  constructor() {
    const host = process.env.REDIS_HOST ?? 'localhost';
    const port = Number(process.env.REDIS_PORT ?? 6379);

    this.queue = new Queue(SagaCommandQueueService.QUEUE_NAME, {
      connection: { host, port },
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      },
    });

    this.logger.log(
      `Queue "${SagaCommandQueueService.QUEUE_NAME}" lista en ${host}:${port}`,
    );
  }

  async add<T>(command: string, data: T, opts?: JobsOptions): Promise<void> {
    await this.queue.add(command, data, opts);
  }

  async onModuleDestroy() {
    await this.queue?.close();
  }
}
