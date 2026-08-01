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
import { SagaInstance } from '../entities/saga-instance.entity';
import { SagaCommandQueueService } from '../queues/saga-command-queue.service';
import type { SagaReply } from '../queues/saga-reply-worker.service';

/**
 * Definición declarativa de un step. Para el happy path solo distinguimos:
 *  - `kind: 'local'` → corre `action(em, payload)` en una transacción y
 *    devuelve un patch que se mergea al payload de la saga.
 *  - `kind: 'remote'` → se dispatcha un comando por `saga-commands`; la
 *    saga queda `awaiting_step_response` hasta que el reply-worker la
 *    despierte con `handleReply()`.
 *
 * La compensación se declarará en una próxima iteración.
 */
type LocalStep = {
  name: string;
  kind: 'local';
  action: (
    em: EntityManager,
    payload: RentalSagaPayload,
  ) => Promise<Partial<RentalSagaPayload>>;
};
type RemoteStep = {
  name: string;
  kind: 'remote';
  command: string;
  buildCommand: (payload: RentalSagaPayload) => Record<string, unknown>;
};
type SagaStep = LocalStep | RemoteStep;

export interface RentalSagaPayload {
  // input
  filmId: number;
  storeId: number;
  customerId: number;
  staffId: number;
  // enriquecido por los steps
  rentalId?: number;
  inventoryId?: number;
  amount?: number;
  paymentId?: number;
}

@Injectable()
export class RentalSagaOrchestrator {
  private readonly logger = new Logger(RentalSagaOrchestrator.name);

  private readonly steps: SagaStep[] = [
    {
      name: 'createRental',
      kind: 'local',
      action: (em, p) => this.createRental(em, p),
    },
    {
      name: 'reserveStock',
      kind: 'remote',
      command: 'ReserveStock',
      buildCommand: (p) => ({
        filmId: p.filmId,
        storeId: p.storeId,
      }),
    },
    {
      name: 'chargePayment',
      kind: 'local',
      action: (em, p) => this.chargePayment(em, p),
    },
  ];

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly commandQueue: SagaCommandQueueService,
  ) {}

  // ─── entry point ──────────────────────────────────────────────────────

  async start(input: {
    filmId: number;
    storeId: number;
    customerId: number;
    staffId: number;
  }): Promise<{ sagaId: string; status: string }> {
    const saga = await this.dataSource.getRepository(SagaInstance).save({
      sagaType: 'RentalSaga',
      status: 'running',
      currentStep: 0,
      payload: input,
      completedSteps: [],
    });

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
    // Cargamos fuera de tx para el dispatch, pero cada step local
    // se ejecuta con `SELECT ... FOR UPDATE` sobre saga_instance para
    // serializar advances concurrentes (worker HTTP + reply-worker).
    const saga = await this.loadSaga(sagaId);
    if (!saga) throw new NotFoundException(`saga ${sagaId} no existe`);
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
      await this.runLocalStep(sagaId, step);
      // seguimos avanzando en el mismo tick
      await this.advance(sagaId);
    } else {
      await this.dispatchRemoteStep(sagaId, step);
      // no llamamos advance; el reply-worker despierta la saga
    }
  }

  // ─── steps locales ────────────────────────────────────────────────────

  private async runLocalStep(sagaId: string, step: LocalStep): Promise<void> {
    await this.dataSource.transaction(async (em) => {
      // Lock pesimista sobre la saga → evita que dos advances corran el
      // mismo step en paralelo.
      const [saga] = await em.query(
        `SELECT * FROM saga_instance WHERE id = $1 FOR UPDATE`,
        [sagaId],
      );

      if (!saga || saga.status !== 'running') return;
      if (saga.completed_steps.includes(step.name)) return; // idempotencia

      const patch = await step.action(em, saga.payload);
      const newPayload = { ...saga.payload, ...patch };
      const newCompleted = [...saga.completed_steps, step.name];
      const nextStep = saga.current_step + 1;
      const nextStatus =
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
  }

  private async createRental(
    em: EntityManager,
    p: RentalSagaPayload,
  ): Promise<Partial<RentalSagaPayload>> {
    // 1) reservar un inventory disponible con lock (misma lógica que
    // RentalService.createRental — sin duplicar el path del outbox).
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

    // 2) tarifa
    const film = await em.getRepository(Film).findOne({
      where: { filmId: p.filmId },
      select: { filmId: true, rentalRate: true },
    });
    if (!film) throw new NotFoundException(`film ${p.filmId} no encontrado`);

    // 3) crear rental en estado pending (la confirmación se hace en el
    // step final `chargePayment`).
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

  // ─── step remoto ──────────────────────────────────────────────────────

  private async dispatchRemoteStep(
    sagaId: string,
    step: RemoteStep,
  ): Promise<void> {
    // 1) marcar la saga como esperando respuesta antes de encolar,
    // así el reply-worker nunca ve un estado inconsistente aunque el
    // consumer responda muy rápido.
    await this.dataSource.transaction(async (em) => {
      const [saga] = await em.query(
        `SELECT * FROM saga_instance WHERE id = $1 FOR UPDATE`,
        [sagaId],
      );
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
        payload: step.buildCommand(saga.payload),
      },
      { jobId: `${sagaId}:${step.name}` }, // dedup natural
    );

    this.logger.log(
      `saga ${sagaId} → dispatch ${step.command} (step=${step.name})`,
    );
  }

  // ─── entrada desde el reply-worker ────────────────────────────────────

  async handleReply(reply: SagaReply): Promise<void> {
    const { sagaId, step, result } = reply;

    if (result !== 'confirmed') {
      // La compensación queda para la próxima iteración.
      this.logger.warn(
        `saga ${sagaId} recibió reply "${result}" en step ${step} — compensación no implementada`,
      );
      return;
    }

    await this.dataSource.transaction(async (em) => {
      const [saga] = await em.query(
        `SELECT * FROM saga_instance WHERE id = $1 FOR UPDATE`,
        [sagaId],
      );
      if (!saga) return;

      // idempotencia: si ya avanzamos, ignoramos la respuesta duplicada.
      if (saga.completed_steps.includes(step)) return;
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

    this.logger.log(`saga ${sagaId} ← reply ${step} confirmed → resume`);
    await this.advance(sagaId);
  }

  // ─── helpers ──────────────────────────────────────────────────────────

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
}
