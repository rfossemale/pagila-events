import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { JobsOptions, Queue } from 'bullmq';

/**
 * Cola de respuestas de saga (consumer → producer).
 * El handler de comandos publica acá para despertar la saga.
 */
@Injectable()
export class SagaReplyQueueService implements OnModuleDestroy {
  private readonly logger = new Logger(SagaReplyQueueService.name);
  static readonly QUEUE_NAME = 'saga-replies';

  private readonly queue: Queue;

  constructor() {
    const host = process.env.REDIS_HOST ?? 'localhost';
    const port = Number(process.env.REDIS_PORT ?? 6379);

    this.queue = new Queue(SagaReplyQueueService.QUEUE_NAME, {
      connection: { host, port },
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      },
    });

    this.logger.log(
      `Queue "${SagaReplyQueueService.QUEUE_NAME}" lista en ${host}:${port}`,
    );
  }

  async add<T>(replyType: string, data: T, opts?: JobsOptions): Promise<void> {
    await this.queue.add(replyType, data, opts);
  }

  async onModuleDestroy() {
    await this.queue?.close();
  }
}
