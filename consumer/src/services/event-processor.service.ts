/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { PinoLogger } from 'nestjs-pino';
import type { IncomingEvent } from '../types/index';
import { MetricsService } from '../metrics/metrics.service';

/**
 * Aplica un evento entrante a las tablas del consumer.
 *
 * Responsabilidades:
 *   1. Idempotencia: usa `consumer.processed_events` como candado —
 *      el INSERT ... ON CONFLICT DO NOTHING decide en una sola operación
 *      atómica si es la primera vez que se ve el evento o un duplicado.
 *   2. Orden: `consumer.aggregate_version` guarda la última versión aplicada
 *      por agregado; se descartan eventos con `payload.version` menor o
 *      igual (old-or-equal).
 *   3. Proyección: actualiza `consumer.inventory_availability` según el
 *      `eventType` (RentalStarted −1, RentalReturned +1).
 *
 * Todo corre en la misma transacción, sea que el evento venga por HTTP o
 * por la cola BullMQ.
 */
@Injectable()
export class EventProcessorService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly metrics: MetricsService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(EventProcessorService.name);
  }

  async process(evt: IncomingEvent): Promise<void> {
    const log = {
      eventId: evt.eventId,
      eventType: evt.eventType,
      aggregateId: evt.aggregateId,
      version: evt.payload.version,
    };
    let result: 'applied' | 'duplicate' | 'stale' = 'applied';

    try {
      await this.dataSource.transaction(async (em) => {
        this.logger.debug(log, 'procesando evento');

        // 1) intentar registrar el evento como procesado (candado de idempotencia).
        const res = await em.query(
          `INSERT INTO consumer.processed_events (event_id)
           VALUES ($1) ON CONFLICT DO NOTHING`,
          [evt.eventId],
        );

        // 2) si no insertó nada, ya fue procesado → descartar.
        if (res.rowCount === 0) {
          result = 'duplicate';
          this.logger.debug(log, 'evento duplicado, descartado');
          return;
        }

        // 3) primera vez → aplicar el efecto en la misma tx.
        result = await this.applyEffect(em, evt);
      });
    } catch (err) {
      this.logger.error({ ...log, err }, 'error procesando evento');
      throw err;
    }

    if (result === 'applied') {
      this.logger.info(log, 'evento aplicado');
    }

    // La métrica se registra tras el commit para no contar tx revertidas.
    this.metrics.recordEvent(evt.eventType, result);
  }

  private async applyEffect(
    em: EntityManager,
    evt: IncomingEvent,
  ): Promise<'applied' | 'stale'> {
    const aggId = evt.aggregateId;
    const incoming = evt.payload.version;

    const cur = await em.query(
      `SELECT version FROM consumer.aggregate_version WHERE aggregate_id = $1`,
      [aggId],
    );

    // Guard de orden: descartar si llegó algo viejo o igual.
    if (cur.length && incoming !== undefined && incoming <= cur[0].version) {
      this.logger.warn(
        { aggregateId: aggId, incoming, current: cur[0].version },
        'evento fuera de orden, descartado',
      );
      return 'stale';
    }

    // Aplicar el efecto según el tipo.
    if (evt.eventType === 'RentalStarted') {
      await em.query(
        `UPDATE consumer.inventory_availability
            SET available = available - 1
          WHERE film_id = $1 AND store_id = $2`,
        [evt.payload.filmId, evt.payload.storeId],
      );
    } else if (evt.eventType === 'RentalReturned') {
      await em.query(
        `UPDATE consumer.inventory_availability
            SET available = available + 1
          WHERE film_id = $1 AND store_id = $2`,
        [evt.payload.filmId, evt.payload.storeId],
      );
    }

    // Registrar la nueva versión aplicada.
    await em.query(
      `INSERT INTO consumer.aggregate_version (aggregate_id, version)
       VALUES ($1, $2)
       ON CONFLICT (aggregate_id) DO UPDATE SET version = $2`,
      [aggId, incoming],
    );

    return 'applied';
  }
}
