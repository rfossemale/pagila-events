import { Module } from '@nestjs/common';

import { SagaCommandHandlerService } from './services/saga-command-handler.service';
import { SagaCommandWorkerService } from './queues/saga-command-worker.service';
import { SagaReplyQueueService } from './queues/saga-reply-queue.service';

/**
 * Módulo del participante Saga (consumer).
 *
 * Encapsula:
 *  - el worker que consume `saga-commands`,
 *  - el handler de comandos (`ReserveStock`),
 *  - la cola out `saga-replies`.
 */
@Module({
  providers: [
    SagaCommandHandlerService,
    SagaCommandWorkerService,
    SagaReplyQueueService,
  ],
  exports: [SagaCommandHandlerService],
})
export class SagaModule {}
