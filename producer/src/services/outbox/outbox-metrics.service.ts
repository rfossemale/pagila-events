import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class OutboxMetricsService {
  constructor(private readonly dataSource: DataSource) {}

  async snapshot() {
    const rowsUnknown: unknown = await this.dataSource.query(`
      SELECT
        count(*) FILTER (WHERE status = 'pending') AS pending,
        count(*) FILTER (WHERE status = 'failed')  AS failed,
        EXTRACT(
          EPOCH FROM now() - min(created_at) FILTER (WHERE status = 'pending')
        ) AS oldest_pending_secs
      FROM outbox
    `);

    const row =
      Array.isArray(rowsUnknown) && rowsUnknown.length > 0
        ? (rowsUnknown[0] as Record<string, unknown>)
        : {};

    return {
      pending: Number(row.pending ?? 0),
      failed: Number(row.failed ?? 0),
      oldest_pending_secs:
        row.oldest_pending_secs == null
          ? null
          : Number(row.oldest_pending_secs),
    };
  }
}