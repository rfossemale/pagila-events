import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Job, Worker } from 'bullmq';
import {
  SagaCommand,
  SagaCommandHandlerService,
} from '../services/saga-command-handler.service';

const QUEUE_NAME = 'saga-commands';

/**
 * Worker que consume `saga-commands` y delega en el handler.
 */
@Injectable()
export class SagaCommandWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SagaCommandWorkerService.name);
  private worker!: Worker<SagaCommand>;

  constructor(private readonly handler: SagaCommandHandlerService) {}

  onModuleInit() {
    const connection = {
      host: process.env.REDIS_HOST ?? 'localhost',
      port: Number(process.env.REDIS_PORT ?? 6379),
    };

    this.worker = new Worker<SagaCommand>(
      QUEUE_NAME,
      async (job: Job<SagaCommand>) => {
        await this.handler.handle(job.data);
      },
      { connection, concurrency: 5 },
    );

    this.worker.on('completed', (job) => {
      this.logger.log(`✅ cmd ${job.id} (${job.name}) procesado`);
    });
    this.worker.on('failed', (job, err) => {
      this.logger.error(
        `❌ cmd ${job?.id} (${job?.name}) falló: ${err.message}`,
      );
    });

    this.logger.log(
      `Worker "${QUEUE_NAME}" escuchando en ${connection.host}:${connection.port}`,
    );
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }
}
