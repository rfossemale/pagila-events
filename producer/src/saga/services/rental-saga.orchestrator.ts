import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { Film } from '../../entities/film.entity';
import { Payment } from '../../entities/payment.entity';
import { Rental } from '../../entities/rental.entity';
import { SagaInstance, SagaStatus } from '../entities/saga-instance.entity';
import { SagaCommandQueueService } from '../queues/saga-command-queue.service';
import type { SagaReply } from '../queues/saga-reply-worker.service';

/**
 * Definición declarativa de un step.
 *  - `kind: 'local'`  → `action` corre en tx; `compensation` (opcional)
 *    revierte en tx.
 *  - `kind: 'remote'` → se dispatcha `command` por `saga-commands` y la
 *    saga queda `awaiting_step_response`. Si tiene
 *    `compensationCommand`, la compensación dispatcha ese comando y la
 *    saga queda `awaiting_compensation_response`.
 *
 * `completed_steps` actúa como un stack: durante compensación se camina
 * al revés y se hace pop por cada compensación exitosa.
 */
type LocalStep = {
  name: string;
  kind: 'local';
  action: (
    em: EntityManager,
    payload: RentalSagaPayload,
  ) => Promise<Partial<RentalSagaPayload>>;
  compensation?: (
    em: EntityManager,
    payload: RentalSagaPayload,
  ) => Promise<void>;
};
type RemoteStep = {
  name: string;
  kind: 'remote';
  command: string;
  buildCommand: (payload: RentalSagaPayload) => Record<string, unknown>;
  compensationCommand?: string;
  buildCompensationCommand?: (
    payload: RentalSagaPayload,
  ) => Record<string, unknown>;
};
type SagaStep = LocalStep | RemoteStep;

export interface RentalSagaPayload {
  filmId: number;
  storeId: number;
  customerId: number;
  staffId: number;
  // enriquecido por los steps
  rentalId?: number;
  inventoryId?: number;
  amount?: number;
  paymentId?: number;
  // fault injection educativo
  simulateFailure?: 'chargePayment';
}

/** Shape de las filas crudas de `saga_instance` (snake_case). */
interface SagaRow {
  id: string;
  saga_type: string;
  status: SagaStatus;
  current_step: number;
  payload: RentalSagaPayload;
  completed_steps: string[];
  last_error: string | null;
}

@Injectable()
export class RentalSagaOrchestrator {
  private readonly logger = new Logger(RentalSagaOrchestrator.name);

  private readonly steps: SagaStep[] = [
    {
      name: 'createRental',
      kind: 'local',
      action: (em, p) => this.createRental(em, p),
      compensation: (em, p) => this.cancelRental(em, p),
    },
    {
      name: 'reserveStock',
      kind: 'remote',
      command: 'ReserveStock',
      buildCommand: (p) => ({ filmId: p.filmId, storeId: p.storeId }),
      compensationCommand: 'ReleaseStock',
      buildCompensationCommand: (p) => ({
        filmId: p.filmId,
        storeId: p.storeId,
      }),
    },
    {
      name: 'chargePayment',
      kind: 'local',
      action: (em, p) => this.chargePayment(em, p),
      compensation: (em, p) => this.refundPayment(em, p),
    },
  ];

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly commandQueue: SagaCommandQueueService,
  ) {}

  // ─── entry point ──────────────────────────────────────────────────────

  async start(
    input: RentalSagaPayload,
  ): Promise<{ sagaId: string; status: SagaStatus }> {
    const repo = this.dataSource.getRepository(SagaInstance);
    const saga = await repo.save(
      repo.create({
        sagaType: 'RentalSaga',
        status: 'running',
        currentStep: 0,
        payload: input as unknown as Record<string, unknown>,
        completedSteps: [],
      }),
    );

    this.logger.log(`saga ${saga.id} iniciada`);

    // fire-and-forget: no bloqueamos la respuesta HTTP
    void this.advance(saga.id).catch((err: unknown) => {
      this.logger.error(
        `advance(${saga.id}) explotó: ${err instanceof Error ? err.message : String(err)}`,
      );
    });

    return { sagaId: saga.id, status: saga.status };
  }

  // ─── loop principal ───────────────────────────────────────────────────

  async advance(sagaId: string): Promise<void> {
    const saga = await this.loadSaga(sagaId);
    if (!saga) throw new NotFoundException(`saga ${sagaId} no existe`);

    if (saga.status === 'compensating') return this.compensate(sagaId);
    if (saga.status !== 'running') {
      this.logger.log(
        `saga ${sagaId} no está running (status=${saga.status}), skip`,
      );
      return;
    }

    if (saga.currentStep >= this.steps.length) {
      await this.markCompleted(sagaId);
      return;
    }

    const step = this.steps[saga.currentStep];
    this.logger.log(
      `saga ${sagaId} → step[${saga.currentStep}] ${step.name} (${step.kind})`,
    );

    if (step.kind === 'local') {
      const ok = await this.runLocalStep(sagaId, step);
      return ok ? this.advance(sagaId) : this.compensate(sagaId);
    }

    await this.dispatchRemoteStep(sagaId, step);
    // no llamamos advance; el reply-worker despierta la saga
  }

  // ─── forward: local ───────────────────────────────────────────────────

  private async runLocalStep(
    sagaId: string,
    step: LocalStep,
  ): Promise<boolean> {
    try {
      await this.dataSource.transaction(async (em) => {
        const saga = await this.lockSaga(em, sagaId);
        if (!saga || saga.status !== 'running') return;
        if (saga.completed_steps.includes(step.name)) return; // idempotencia

        const patch = await step.action(em, saga.payload);
        const newPayload = { ...saga.payload, ...patch };
        const newCompleted = [...saga.completed_steps, step.name];
        const nextStep = saga.current_step + 1;
        const nextStatus: SagaStatus =
          nextStep >= this.steps.length ? 'completed' : 'running';

        await em.query(
          `UPDATE saga_instance
              SET payload = $2,
                  completed_steps = $3::jsonb,
                  current_step = $4,
                  status = $5,
                  updated_at = now()
            WHERE id = $1`,
          [
            sagaId,
            newPayload,
            JSON.stringify(newCompleted),
            nextStep,
            nextStatus,
          ],
        );

        this.logger.log(
          `saga ${sagaId} ✓ ${step.name} → step=${nextStep}, status=${nextStatus}`,
        );
      });
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`saga ${sagaId} ✗ ${step.name}: ${msg}`);
      await this.markCompensating(sagaId, `${step.name}: ${msg}`);
      return false;
    }
  }

  private async createRental(
    em: EntityManager,
    p: RentalSagaPayload,
  ): Promise<Partial<RentalSagaPayload>> {
    const rows = await em.query<Array<{ inventory_id: number }>>(
      `
      SELECT i.inventory_id
      FROM inventory i
      WHERE i.film_id = $1
        AND i.store_id = $2
        AND NOT EXISTS (
          SELECT 1 FROM rental r
           WHERE r.inventory_id = i.inventory_id
             AND r.return_date IS NULL
        )
      ORDER BY i.inventory_id
      LIMIT 1
      FOR UPDATE OF i SKIP LOCKED
      `,
      [p.filmId, p.storeId],
    );
    if (rows.length === 0) {
      throw new ConflictException(
        `no hay ejemplares disponibles del film ${p.filmId} en tienda ${p.storeId}`,
      );
    }
    const inventoryId = rows[0].inventory_id;

    const film = await em.getRepository(Film).findOne({
      where: { filmId: p.filmId },
      select: { filmId: true, rentalRate: true },
    });
    if (!film) throw new NotFoundException(`film ${p.filmId} no encontrado`);

    const rentalRepo = em.getRepository(Rental);
    const now = new Date();
    const rental = await rentalRepo.save(
      rentalRepo.create({
        inventoryId,
        customerId: p.customerId,
        staffId: p.staffId,
        rentalDate: now,
        returnDate: null,
      }),
    );
    await em.query(
      `UPDATE rental SET status = 'pending' WHERE rental_id = $1`,
      [rental.rentalId],
    );

    return {
      rentalId: rental.rentalId,
      inventoryId,
      amount: Number(film.rentalRate),
    };
  }

  private async chargePayment(
    em: EntityManager,
    p: RentalSagaPayload,
  ): Promise<Partial<RentalSagaPayload>> {
    if (p.rentalId == null || p.amount == null) {
      throw new Error('chargePayment: falta rentalId o amount en el payload');
    }
    if (p.simulateFailure === 'chargePayment') {
      throw new Error('simulated failure at chargePayment');
    }

    const paymentRepo = em.getRepository(Payment);
    const now = new Date();
    const payment = await paymentRepo.save(
      paymentRepo.create({
        customerId: p.customerId,
        staffId: p.staffId,
        rentalId: p.rentalId,
        amount: p.amount,
        paymentDate: now,
      }),
    );

    await em.query(
      `UPDATE rental SET status = 'confirmed' WHERE rental_id = $1`,
      [p.rentalId],
    );

    return { paymentId: payment.paymentId };
  }

  // ─── compensaciones locales ───────────────────────────────────────────

  private async cancelRental(
    em: EntityManager,
    p: RentalSagaPayload,
  ): Promise<void> {
    if (p.rentalId == null) return;
    // return_date=now() libera el UNIQUE parcial `uq_inventory_active_rental`.
    await em.query(
      `UPDATE rental
          SET status = 'cancelled',
              return_date = now(),
              last_update = now()
        WHERE rental_id = $1 AND return_date IS NULL`,
      [p.rentalId],
    );
  }

  private async refundPayment(
    em: EntityManager,
    p: RentalSagaPayload,
  ): Promise<void> {
    if (p.paymentId != null) {
      await em.query(`DELETE FROM payment WHERE payment_id = $1`, [
        p.paymentId,
      ]);
    }
    if (p.rentalId != null) {
      await em.query(
        `UPDATE rental SET status = 'pending' WHERE rental_id = $1`,
        [p.rentalId],
      );
    }
  }

  // ─── forward: remoto ──────────────────────────────────────────────────

  private async dispatchRemoteStep(
    sagaId: string,
    step: RemoteStep,
  ): Promise<void> {
    await this.dataSource.transaction(async (em) => {
      const saga = await this.lockSaga(em, sagaId);
      if (!saga || saga.status !== 'running') return;

      await em.query(
        `UPDATE saga_instance
            SET status = 'awaiting_step_response', updated_at = now()
          WHERE id = $1`,
        [sagaId],
      );
    });

    const saga = await this.loadSaga(sagaId);
    if (!saga) return;

    await this.commandQueue.add(
      step.command,
      {
        sagaId,
        step: step.name,
        command: step.command,
        phase: 'forward' as const,
        payload: step.buildCommand(
          saga.payload as unknown as RentalSagaPayload,
        ),
      },
      { jobId: `${sagaId}:${step.name}:forward` },
    );

    this.logger.log(
      `saga ${sagaId} → dispatch ${step.command} (step=${step.name})`,
    );
  }

  // ─── compensación ─────────────────────────────────────────────────────

  private async compensate(sagaId: string): Promise<void> {
    const saga = await this.loadSaga(sagaId);
    if (!saga) return;
    if (saga.status !== 'compensating') return;

    if (saga.completedSteps.length === 0) {
      await this.markFailed(sagaId);
      return;
    }

    const lastName = saga.completedSteps[saga.completedSteps.length - 1];
    const step = this.steps.find((s) => s.name === lastName);
    if (!step) {
      this.logger.error(
        `saga ${sagaId}: step "${lastName}" no está declarado, no puedo compensar`,
      );
      await this.markFailed(sagaId);
      return;
    }

    if (step.kind === 'local') {
      if (step.compensation) {
        await this.runLocalCompensation(sagaId, step);
      } else {
        await this.popCompletedStep(sagaId, step.name);
      }
      return this.compensate(sagaId);
    }

    if (step.compensationCommand && step.buildCompensationCommand) {
      await this.dispatchRemoteCompensation(sagaId, step);
      return;
    }

    // sin compensación remota declarada → pop y seguir
    await this.popCompletedStep(sagaId, step.name);
    return this.compensate(sagaId);
  }

  private async runLocalCompensation(
    sagaId: string,
    step: LocalStep,
  ): Promise<void> {
    await this.dataSource.transaction(async (em) => {
      const saga = await this.lockSaga(em, sagaId);
      if (!saga || saga.status !== 'compensating') return;

      const stack = saga.completed_steps;
      if (stack[stack.length - 1] !== step.name) return; // idempotencia

      await step.compensation!(em, saga.payload);

      const newCompleted = stack.slice(0, -1);
      await em.query(
        `UPDATE saga_instance
            SET completed_steps = $2::jsonb,
                current_step = $3,
                updated_at = now()
          WHERE id = $1`,
        [sagaId, JSON.stringify(newCompleted), newCompleted.length],
      );

      this.logger.log(`saga ${sagaId} ↩ ${step.name} compensado`);
    });
  }

  private async dispatchRemoteCompensation(
    sagaId: string,
    step: RemoteStep,
  ): Promise<void> {
    await this.dataSource.transaction(async (em) => {
      const saga = await this.lockSaga(em, sagaId);
      if (!saga || saga.status !== 'compensating') return;

      await em.query(
        `UPDATE saga_instance
            SET status = 'awaiting_compensation_response', updated_at = now()
          WHERE id = $1`,
        [sagaId],
      );
    });

    const saga = await this.loadSaga(sagaId);
    if (!saga) return;

    await this.commandQueue.add(
      step.compensationCommand!,
      {
        sagaId,
        step: step.name,
        command: step.compensationCommand,
        phase: 'compensation' as const,
        payload: step.buildCompensationCommand!(
          saga.payload as unknown as RentalSagaPayload,
        ),
      },
      { jobId: `${sagaId}:${step.name}:compensation` },
    );

    this.logger.log(
      `saga ${sagaId} ↩ dispatch ${step.compensationCommand!} (step=${step.name})`,
    );
  }

  private async popCompletedStep(
    sagaId: string,
    expectedName: string,
  ): Promise<void> {
    await this.dataSource.transaction(async (em) => {
      const saga = await this.lockSaga(em, sagaId);
      if (!saga) return;
      const stack = saga.completed_steps;
      if (stack[stack.length - 1] !== expectedName) return;

      const newCompleted = stack.slice(0, -1);
      await em.query(
        `UPDATE saga_instance
            SET completed_steps = $2::jsonb,
                current_step = $3,
                status = 'compensating',
                updated_at = now()
          WHERE id = $1`,
        [sagaId, JSON.stringify(newCompleted), newCompleted.length],
      );
    });
  }

  // ─── entrada desde el reply-worker ────────────────────────────────────

  async handleReply(reply: SagaReply): Promise<void> {
    const { sagaId, step, result } = reply;
    const saga = await this.loadSaga(sagaId);
    if (!saga) return;

    if (saga.status === 'awaiting_step_response') {
      if (result === 'confirmed') {
        await this.confirmForwardReply(sagaId, step);
        this.logger.log(`saga ${sagaId} ← reply ${step} confirmed → resume`);
        return this.advance(sagaId);
      }
      this.logger.warn(
        `saga ${sagaId} ← reply ${step} rejected: ${reply.error ?? '(sin msg)'}`,
      );
      await this.markCompensating(
        sagaId,
        `${step}: ${reply.error ?? 'rejected'}`,
      );
      return this.compensate(sagaId);
    }

    if (saga.status === 'awaiting_compensation_response') {
      await this.popCompletedStep(sagaId, step);
      this.logger.log(`saga ${sagaId} ↩ reply ${step} → continue compensating`);
      return this.compensate(sagaId);
    }

    this.logger.warn(
      `saga ${sagaId} reply ${step} ignorada (status=${saga.status})`,
    );
  }

  private async confirmForwardReply(
    sagaId: string,
    step: string,
  ): Promise<void> {
    await this.dataSource.transaction(async (em) => {
      const saga = await this.lockSaga(em, sagaId);
      if (!saga) return;
      if (saga.completed_steps.includes(step)) return; // idempotencia
      if (saga.status !== 'awaiting_step_response') return;

      const newCompleted = [...saga.completed_steps, step];
      await em.query(
        `UPDATE saga_instance
            SET status = 'running',
                current_step = $2,
                completed_steps = $3::jsonb,
                updated_at = now()
          WHERE id = $1`,
        [sagaId, saga.current_step + 1, JSON.stringify(newCompleted)],
      );
    });
  }

  // ─── helpers ──────────────────────────────────────────────────────────

  private async lockSaga(
    em: EntityManager,
    sagaId: string,
  ): Promise<SagaRow | undefined> {
    const rows = await em.query<SagaRow[]>(
      `SELECT * FROM saga_instance WHERE id = $1 FOR UPDATE`,
      [sagaId],
    );
    return rows[0];
  }

  private async loadSaga(sagaId: string): Promise<SagaInstance | null> {
    return this.dataSource
      .getRepository(SagaInstance)
      .findOne({ where: { id: sagaId } });
  }

  private async markCompleted(sagaId: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE saga_instance
          SET status = 'completed', updated_at = now()
        WHERE id = $1 AND status = 'running'`,
      [sagaId],
    );
    this.logger.log(`saga ${sagaId} ✅ completed`);
  }

  private async markCompensating(
    sagaId: string,
    reason: string,
  ): Promise<void> {
    await this.dataSource.query(
      `UPDATE saga_instance
          SET status = 'compensating',
              last_error = $2,
              updated_at = now()
        WHERE id = $1
          AND status IN ('running','awaiting_step_response')`,
      [sagaId, reason],
    );
    this.logger.warn(`saga ${sagaId} ⚠ compensating: ${reason}`);
  }

  private async markFailed(sagaId: string): Promise<void> {
    await this.dataSource.query(
      `UPDATE saga_instance
          SET status = 'failed', updated_at = now()
        WHERE id = $1 AND status = 'compensating'`,
      [sagaId],
    );
    this.logger.warn(`saga ${sagaId} ❌ failed`);
  }
}
