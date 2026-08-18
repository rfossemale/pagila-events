/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
import { Client, type ClientConfig } from 'pg';
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Interval } from '@nestjs/schedule';
import { PinoLogger } from 'nestjs-pino';
import { RentalQueueService } from '../../queues/rental-queue.service';

type OutboxRow = {
  id: string;
  event_type: string;
  aggregate_id: string;
  payload: unknown;
};

@Injectable()
export class OutboxRelayService {
  private running = false;
  constructor(
    private readonly dataSource: DataSource,
    private readonly rentalQueue: RentalQueueService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(OutboxRelayService.name);
  }

  async onModuleInit() {
    // Ver 07-listen-notify-trigger.ts ( LISTEN/NOTIFY )
    const clientConfig: ClientConfig = {
      host: process.env.DB_HOST ?? 'localhost',
      port: Number(process.env.DB_PORT ?? 5433),
      user: process.env.DB_USER ?? 'pagila',
      password: process.env.DB_PASSWORD ?? 'pagila',
      database: process.env.DB_NAME ?? 'pagila',
    };
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
    const client: Client = new Client(clientConfig);
    await client.connect();
    await client.query('LISTEN outbox_new');
    client.on('notification', () => this.triggerCycle());
  }

  @Interval(30000) // red de seguridad
  async onTimer() {
    await this.triggerCycle();
  }

  private async triggerCycle() {
    if (this.running) return; // no acumular ciclos
    this.running = true;
    try {
      await this.tick();
    } finally {
      this.running = false;
    }
  }

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
          await this.publish(row);
          await em.query(
            `UPDATE outbox SET status='published', published_at=now() WHERE id=$1`,
            [row.id],
          );
        } catch (err: unknown) {
          this.logger.error(
            {
              outboxId: row.id,
              eventType: row.event_type,
              aggregateId: row.aggregate_id,
              err,
            },
            'error publicando evento del outbox',
          );
          //  await this.handleFailure(em, row, err);
        }
      }
    });
  }

  private async publishToAPI(row: OutboxRow) {
    this.logger.debug(
      {
        outboxId: row.id,
        eventType: row.event_type,
        aggregateId: row.aggregate_id,
      },
      'publicando evento (HTTP)',
    );
    await fetch('http://localhost:3001/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId: row.id,
        eventType: row.event_type,
        aggregateId: row.aggregate_id,
        payload: row.payload,
      }),
    }).then((r) => {
      if (!r.ok) throw new Error(`consumer respondió ${r.status}`);
    });
  }

  private async publish(row: OutboxRow) {
    this.logger.debug(
      {
        outboxId: row.id,
        eventType: row.event_type,
        aggregateId: row.aggregate_id,
      },
      'publicando evento a la cola',
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
