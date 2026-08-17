import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Interval } from '@nestjs/schedule';
import { RentalQueueService } from '../../queues/rental-queue.service';

type OutboxRow = {
  id: string;
  event_type: string;
  aggregate_id: string;
  payload: unknown;
};

@Injectable()
export class OutboxRelayService {
  private readonly logger = new Logger(OutboxRelayService.name);
  constructor(
    private readonly dataSource: DataSource,
    private readonly rentalQueue: RentalQueueService,
  ) {}

  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  @Interval(2000)
  async tick() {
    await this.dataSource.transaction(async (em) => {
      const queryResult: unknown = await em.query(`
        SELECT * FROM outbox
        WHERE status = 'pending'
          AND (next_retry_at IS NULL OR next_retry_at <= now())
        ORDER BY created_at
        LIMIT 20
        FOR UPDATE SKIP LOCKED
      `);
      const rows = Array.isArray(queryResult)
        ? (queryResult as OutboxRow[])
        : [];

      for (const row of rows) {
        try {
          await this.publish(row); // por ahora: console.log
          await em.query(
            `UPDATE outbox SET status='published', published_at=now() WHERE id=$1`,
            [row.id],
          );
        } catch (err) {
          this.logger.error(
            `Error publicando evento ${row.event_type} ${row.aggregate_id}: ${err}`,
          );
          //  await this.handleFailure(em, row, err);
        }
      }
    });
  }

  //   private async publish(row: OutboxRow) {
  //     this.logger.log(
  //       `📤 ${row.event_type} ${row.aggregate_id}: ${JSON.stringify(row.payload)}`,
  //     );
  //     await fetch('http://localhost:3001/events', {
  //       method: 'POST',
  //       headers: { 'Content-Type': 'application/json' },
  //       body: JSON.stringify({
  //         eventId: row.id,
  //         eventType: row.event_type,
  //         aggregateId: row.aggregate_id,
  //         payload: row.payload,
  //       }),
  //     }).then((r) => {
  //       if (!r.ok) throw new Error(`consumer respondió ${r.status}`);
  //     });
  //   }
  // }
  private async publish(row: OutboxRow) {
    this.logger.log(
      `📤 ${row.event_type} ${row.aggregate_id}: ${JSON.stringify(row.payload)}`,
    );
    await this.rentalQueue.add(
      row.event_type,
      {
        eventId: row.id,
        eventType: row.event_type,
        aggregateId: row.aggregate_id,
        payload: row.payload,
      },
      {
        jobId: row.id, // ← clave: dedup a nivel cola
        attempts: 5,
        backoff: { type: 'exponential', delay: 1000 },
      },
    );
  }
}
