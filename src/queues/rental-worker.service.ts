import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Job, Worker } from 'bullmq';
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
  private readonly logger = new Logger(RentalWorkerService.name);
  private worker!: Worker<IncomingEvent>;

  constructor(private readonly processor: EventProcessorService) {}

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
      this.logger.log(`✅ job ${job.id} (${job.name}) procesado`);
    });

    this.worker.on('failed', (job, err) => {
      this.logger.error(
        `❌ job ${job?.id} (${job?.name}) falló: ${err.message} — intento ${
          job?.attemptsMade ?? '?'
        }/${job?.opts.attempts ?? '?'}`,
      );
    });

    this.logger.log(
      `Worker "${QUEUE_NAME}" escuchando en ${connection.host}:${connection.port} (concurrency=5)`,
    );
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }
}
