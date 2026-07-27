import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * Última versión aplicada de cada agregado, usada por el
 * `EventProcessorService` para descartar eventos out-of-order.
 *
 * DDL (db/init/06-consumer.sql):
 *   CREATE TABLE consumer.aggregate_version (
 *     aggregate_id TEXT PRIMARY KEY,
 *     version      INT NOT NULL
 *   );
 */
@Entity({ schema: 'consumer', name: 'aggregate_version' })
export class AggregateVersion {
  @PrimaryColumn({ name: 'aggregate_id', type: 'text' })
  aggregateId!: string;

  @Column({ name: 'version', type: 'int' })
  version!: number;
}
