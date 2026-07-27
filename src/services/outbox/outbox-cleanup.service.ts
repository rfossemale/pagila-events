import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DataSource } from 'typeorm';

@Injectable()
export class OutboxCleanup {
  private readonly logger = new Logger(OutboxCleanup.name);
  constructor(private readonly dataSource: DataSource) {}

  @Cron('0 3 * * *') // 3am, baja carga
  async purge(): Promise<{ deleted: number }> {
    let total = 0;
    for (;;) {
      // pg (via TypeORM.query) devuelve [rows, rowCount] para DELETE sin RETURNING.
      const res = await this.dataSource.query<[unknown[], number]>(`
        DELETE FROM outbox
        WHERE id IN (
          SELECT id FROM outbox
          WHERE status = 'published'
            AND published_at < now() - interval '7 days'
          LIMIT 5000
        )
      `);
      const deleted = res[1] ?? 0;
      total += deleted;
      if (deleted === 0) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    this.logger.log(`purge: ${total} filas eliminadas`);
    return { deleted: total };
  }
}
