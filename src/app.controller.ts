import { Controller, Get, Post, Body, Logger } from '@nestjs/common';
import { AppService } from './app.service';
import { Repository, DataSource, EntityManager } from 'typeorm';
import { InventoryAvailability } from './entities/inventory-availability.entity';
import type { IncomingEvent } from './types/index';

@Controller()
export class AppController {
  private readonly logger: Logger;
  constructor(
    private readonly appService: AppService,
    private readonly repo: Repository<InventoryAvailability>,
    private readonly dataSource: DataSource,
  ) {
    this.logger = new Logger(AppController.name);
  }

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  // @Post('events')
  // async handle(@Body() evt: IncomingEvent) {
  //   if (evt.eventType === 'RentalStarted') {
  //     const { filmId, storeId } = evt.payload;
  //     await this.repo.decrement({ filmId, storeId }, 'available', 1);
  //     // throw new Error('boom');   // el relay verá 500 y reintentará
  //   }
  //   return { ok: true };
  // }

  @Post('events')
  async handle(@Body() evt: IncomingEvent) {
    await this.dataSource.transaction(async (em) => {
      // 1) intentar registrar el evento
      // El truco elegante está en el ON CONFLICT DO NOTHING + chequear rowCount. 
      // En vez de "consultar si existe y después decidir" (que tiene su propia 
      // race condition entre el SELECT y el INSERT), dejás que la PK haga de 
      // árbitro: si el insert no agregó filas, es duplicado. Una sola operación 
      // atómica decide.
      const res = await em.query(
        `INSERT INTO consumer.processed_events (event_id)
       VALUES ($1) ON CONFLICT DO NOTHING`,
        [evt.eventId],
      );

      // 2) si no insertó nada, ya fue procesado → descartar
      if (res.rowCount === 0) {
        this.logger.log(`dup ${evt.eventId}, descartado`);
        return;
      }

      // 3) primera vez → aplicar el efecto, misma transacción
      await this.applyEffect(em, evt);
    });
    return { ok: true };
  }

  async applyEffect(em: EntityManager, evt: IncomingEvent) {
    const aggId = evt.aggregateId;
    const incoming = evt.payload.version;

  const cur = await em.query(
    `SELECT version FROM consumer.aggregate_version WHERE aggregate_id = $1`,
    [aggId],
  );

  // descartar si llegó algo viejo o igual
  if (cur.length && incoming <= cur[0].version) {
    this.logger.log(`evento viejo v${incoming} (actual v${cur[0].version}), descartado`);
    return;
  }

  // aplicar el efecto según el tipo
  if (evt.eventType === 'RentalStarted') {
    await em.query(`UPDATE consumer.inventory_availability SET available = available - 1 WHERE film_id=$1 AND store_id=$2`, [evt.payload.filmId, evt.payload.storeId]);
  } else if (evt.eventType === 'RentalReturned') {
    await em.query(`UPDATE consumer.inventory_availability SET available = available + 1 WHERE film_id=$1 AND store_id=$2`, [evt.payload.filmId, evt.payload.storeId]);
  }

  // registrar la nueva versión
  await em.query(
    `INSERT INTO consumer.aggregate_version (aggregate_id, version)
     VALUES ($1, $2)
     ON CONFLICT (aggregate_id) DO UPDATE SET version = $2`,
    [aggId, incoming],
  );
};
  }
}
