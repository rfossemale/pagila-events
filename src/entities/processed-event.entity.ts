import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * Registro de eventos ya procesados (idempotency store).
 * Usada por el `EventProcessorService` para descartar duplicados vía
 * `INSERT ... ON CONFLICT DO NOTHING`.
 *
 * DDL (db/init/06-consumer.sql):
 *   CREATE TABLE consumer.processed_events (
 *     event_id     UUID PRIMARY KEY,
 *     processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
 *   );
 */
@Entity({ schema: 'consumer', name: 'processed_events' })
export class ProcessedEvent {
  @PrimaryColumn({ name: 'event_id', type: 'uuid' })
  eventId!: string;

  @Column({
    name: 'processed_at',
    type: 'timestamptz',
    default: () => 'now()',
  })
  processedAt!: Date;
}
