/* eslint-disable prettier/prettier */
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Job, Worker } from 'bullmq';
import { PinoLogger } from 'nestjs-pino';
import { EventProcessorService } from '../services/event-processor.service';
import type { IncomingEvent } from '../types/index';

/**
 * Nombre de la cola. Debe coincidir con el producer
 * (`RentalQueueService.QUEUE_NAME` en el proyecto producer).
 */
const QUEUE_NAME = 'rental';

/**
 * BullMQ Worker que consume la cola `rental` y delega el procesamiento
 * a `EventProcessorService` — la MISMA lógica que usa el endpoint
 * HTTP POST /events del `AppController`.
 *
 * - Concurrencia 5.
 * - Conexión Redis desde REDIS_HOST/REDIS_PORT.
 * - Idempotencia + guard de orden + proyección viven en el servicio, no acá.
 * - Si `processor.process` tira, BullMQ aplica los reintentos configurados
 *   por el productor (attempts + backoff exponencial). Agotados, el job va
 *   a la lista `failed` de Redis.
 * - onModuleDestroy cierra el worker limpiamente.
 */
@Injectable()
export class RentalWorkerService implements OnModuleInit, OnModuleDestroy {
  private worker!: Worker<IncomingEvent>;

  constructor(
    private readonly processor: EventProcessorService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(RentalWorkerService.name);
  }

  onModuleInit() {
    const connection = {
      host: process.env.REDIS_HOST ?? 'localhost',
      port: Number(process.env.REDIS_PORT ?? 6379),
    };

    this.worker = new Worker<IncomingEvent>(
      QUEUE_NAME,
      async (job: Job<IncomingEvent>) => {
        await this.processor.process(job.data);
      },
      {
        connection,
        concurrency: 5,
      },
    );

    this.worker.on('completed', (job) => {
      this.logger.info(
        { jobId: job.id, name: job.name },
        'job procesado',
      );
    });

    this.worker.on('failed', (job, err) => {
      this.logger.error(
        {
          jobId: job?.id,
          name: job?.name,
          attempt: job?.attemptsMade,
          maxAttempts: job?.opts.attempts,
          err,
        },
        'job falló',
      );
    });

    this.logger.info(
      { queue: QUEUE_NAME, ...connection, concurrency: 5 },
      'worker escuchando',
    );
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }
}
