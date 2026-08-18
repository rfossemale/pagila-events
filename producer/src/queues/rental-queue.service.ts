import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { JobsOptions, Queue } from 'bullmq';
import { PinoLogger } from 'nestjs-pino';

/**
 * Wrapper Nest sobre una BullMQ Queue.
 *
 * - Cola: `rental` en Redis (host/port configurables por env).
 * - Encapsula la conexión y ofrece `add()` con defaults sensatos
 *   (reintentos exponenciales, dedup por jobId).
 * - Se cierra limpiamente en `onModuleDestroy` para no dejar conexiones
 *   colgadas al parar el proceso.
 */
@Injectable()
export class RentalQueueService implements OnModuleDestroy {
  static readonly QUEUE_NAME = process.env.QUEUE_NAME || 'rental';

  private readonly queue: Queue;

  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(RentalQueueService.name);
    const host = process.env.REDIS_HOST ?? 'localhost';
    const port = Number(process.env.REDIS_PORT ?? 6379);

    this.queue = new Queue(RentalQueueService.QUEUE_NAME, {
      connection: { host, port },
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      },
    });

    this.logger.info(
      { queue: RentalQueueService.QUEUE_NAME, host, port },
      'queue lista',
    );
  }

  /**
   * Encola un job. `jobId` opcional habilita la deduplicación nativa de
   * BullMQ: si otro job con el mismo id ya está en la cola, se ignora.
   */
  async add<T>(name: string, data: T, opts?: JobsOptions): Promise<void> {
    await this.queue.add(name, data, opts);
  }

  /**
   * Expone la `Queue` cruda de BullMQ para integraciones como bull-board.
   * Uso normal de la app debe seguir yendo por `add()`.
   */
  getQueue(): Queue {
    return this.queue;
  }

  async onModuleDestroy() {
    await this.queue?.close();
  }
}
