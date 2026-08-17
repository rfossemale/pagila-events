import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Estado del evento en la outbox.
 *  - pending: aún no publicado (candidato del worker).
 *  - published: publicado exitosamente.
 *  - failed: agotó reintentos; requiere intervención manual.
 */
export type OutboxStatus = 'pending' | 'published' | 'failed';

/**
 * Transactional Outbox.
 *
 * Se escribe en la MISMA transacción que la mutación de dominio (rental,
 * payment, etc.). Un worker separado lee filas `status='pending'`, publica
 * al broker y las marca `published`. Garantiza at-least-once sin 2PC.
 *
 * El índice parcial `idx_outbox_pending` acelera la búsqueda del worker
 * (solo cubre filas pendientes).
 */
@Entity({ name: 'outbox' })
@Index('idx_outbox_pending', ['createdAt'], { where: "status = 'pending'" })
export class Outbox {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ name: 'aggregate_type', type: 'text' })
  aggregateType!: string;

  @Column({ name: 'aggregate_id', type: 'text' })
  aggregateId!: string;

  @Column({ name: 'event_type', type: 'text' })
  eventType!: string;

  @Column({ name: 'payload', type: 'jsonb' })
  payload!: Record<string, unknown>;

  @Column({ name: 'status', type: 'text', default: 'pending' })
  status!: OutboxStatus;

  @Column({ name: 'attempts', type: 'int', default: 0 })
  attempts!: number;

  @Column({ name: 'next_retry_at', type: 'timestamptz', nullable: true })
  nextRetryAt?: Date | null;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError?: string | null;

  @Column({
    name: 'created_at',
    type: 'timestamptz',
    default: () => 'now()',
  })
  createdAt!: Date;

  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  publishedAt?: Date | null;
}
