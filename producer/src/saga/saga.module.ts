import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Film } from '../entities/film.entity';
import { Payment } from '../entities/payment.entity';
import { Rental } from '../entities/rental.entity';
import { SagaInstance } from './entities/saga-instance.entity';

import { SagaRentalController } from './controllers/saga-rental.controller';
import { RentalSagaOrchestrator } from './services/rental-saga.orchestrator';
import { SagaCommandQueueService } from './queues/saga-command-queue.service';
import { SagaReplyWorkerService } from './queues/saga-reply-worker.service';

/**
 * Módulo del patrón Saga (orquestador).
 *
 * Encapsula:
 *  - la entidad `SagaInstance` (tabla de estado),
 *  - el orquestador `RentalSagaOrchestrator` (state machine),
 *  - la cola out `saga-commands` y el worker in `saga-replies`,
 *  - el controller HTTP `POST /sagas/rentals`.
 *
 * Convive con el flujo clásico outbox (RentalService/OutboxRelay), pero
 * queda aislado para que su ciclo de vida sea independiente.
 */
@Module({
  imports: [TypeOrmModule.forFeature([SagaInstance, Rental, Payment, Film])],
  controllers: [SagaRentalController],
  providers: [
    RentalSagaOrchestrator,
    SagaCommandQueueService,
    SagaReplyWorkerService,
  ],
  exports: [RentalSagaOrchestrator],
})
export class SagaModule {}
