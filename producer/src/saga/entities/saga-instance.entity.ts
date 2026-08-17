import {
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Estado del ciclo de vida de la saga.
 *  - running: hay un step local por ejecutar → advance() lo procesa.
 *  - awaiting_step_response: dispatch de comando forward remoto hecho;
 *    la saga duerme hasta que llegue la respuesta por `saga-replies`.
 *  - compensating: se está caminando `completed_steps` al revés
 *    ejecutando compensaciones locales.
 *  - awaiting_compensation_response: dispatch de comando de
 *    compensación remoto hecho; espera la respuesta.
 *  - completed: happy path terminado.
 *  - failed: compensación terminada (saga abortada).
 */
export type SagaStatus =
  | 'running'
  | 'awaiting_step_response'
  | 'compensating'
  | 'awaiting_compensation_response'
  | 'completed'
  | 'failed';

@Entity({ name: 'saga_instance' })
@Index('idx_saga_active', ['status'], {
  where: "status IN ('running', 'compensating')",
})
export class SagaInstance {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ name: 'saga_type', type: 'text' })
  sagaType!: string;

  @Column({ name: 'status', type: 'text', default: 'running' })
  status!: SagaStatus;

  @Column({ name: 'current_step', type: 'int', default: 0 })
  currentStep!: number;

  @Column({ name: 'payload', type: 'jsonb' })
  payload!: Record<string, unknown>;

  @Column({ name: 'completed_steps', type: 'jsonb', default: () => "'[]'" })
  completedSteps!: string[];

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError?: string | null;

  @Column({
    name: 'created_at',
    type: 'timestamptz',
    default: () => 'now()',
  })
  createdAt!: Date;

  @UpdateDateColumn({
    name: 'updated_at',
    type: 'timestamptz',
    default: () => 'now()',
  })
  updatedAt!: Date;
}
