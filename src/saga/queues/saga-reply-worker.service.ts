import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Job, Worker } from 'bullmq';
import { RentalSagaOrchestrator } from '../services/rental-saga.orchestrator';

/**
 * Cola de respuestas de saga (consumer → producer).
 * El worker consume jobs y despierta la saga correspondiente delegando
 * en el orquestador (`handleReply`). El nombre del job identifica el
 * tipo de respuesta (ej: `StockReserved`).
 */
export const SAGA_REPLIES_QUEUE = 'saga-replies';

export interface SagaReply {
  sagaId: string;
  step: string; // nombre del step al que responde
  result: 'confirmed' | 'rejected';
  error?: string;
}

@Injectable()
export class SagaReplyWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SagaReplyWorkerService.name);
  private worker!: Worker<SagaReply>;

  constructor(private readonly orchestrator: RentalSagaOrchestrator) {}

  onModuleInit() {
    const connection = {
      host: process.env.REDIS_HOST ?? 'localhost',
      port: Number(process.env.REDIS_PORT ?? 6379),
    };

    this.worker = new Worker<SagaReply>(
      SAGA_REPLIES_QUEUE,
      async (job: Job<SagaReply>) => {
        await this.orchestrator.handleReply(job.data);
      },
      { connection, concurrency: 5 },
    );

    this.worker.on('completed', (job) => {
      this.logger.log(`✅ reply ${job.id} (${job.name}) procesada`);
    });
    this.worker.on('failed', (job, err) => {
      this.logger.error(
        `❌ reply ${job?.id} (${job?.name}) falló: ${err.message}`,
      );
    });

    this.logger.log(
      `Worker "${SAGA_REPLIES_QUEUE}" escuchando en ${connection.host}:${connection.port}`,
    );
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }
}
