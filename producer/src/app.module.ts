import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Actor } from './entities/actor.entity';
import { Film } from './entities/film.entity';
import { FilmActor } from './entities/film_actor.entity';
import { Inventory } from './entities/inventory.entity';
import { Store } from './entities/store.entity';
import { Staff } from './entities/staff.entity';
import { Customer } from './entities/customer.entity';
import { Rental } from './entities/rental.entity';
import { Payment } from './entities/payment.entity';
import { Language } from './entities/language.entity';
import { Category } from './entities/category.entity';
import { FilmCategory } from './entities/film_category.entity';
import { Address } from './entities/address.entity';
import { City } from './entities/city.entity';
import { Country } from './entities/country.entity';
import { Outbox } from './entities/outbox.entity';
import { SagaInstance } from './saga/entities/saga-instance.entity';
import { ScheduleModule } from '@nestjs/schedule';

import { ActorController } from './controllers/actor.controller';
import { ActorService } from './services/actor.service';
import { FilmController } from './controllers/films.controllers';
import { FilmService } from './services/film.service';
import { RentalController } from './controllers/rental.controller';
import { RentalService } from './services/rental.service';
import { OutboxRelayService } from './services/outbox/outbox-relay.service';
import { OutboxMetricsService } from './services/outbox/outbox-metrics.service';
import { RentalQueueService } from './queues/rental-queue.service';
import { HealthController } from './controllers/health.controller';
import { OutboxController } from './controllers/outbox.controller';
import { OutboxCleanup } from './services/outbox/outbox-cleanup.service';
import { SagaModule } from './saga/saga.module';

// SagaInstance queda en el root sólo para que el DataSource la descubra;
// su repo, controller y providers viven en SagaModule.
const entities = [
  Film,
  Actor,
  FilmActor,
  Inventory,
  Store,
  Staff,
  Customer,
  Rental,
  Payment,
  Language,
  Category,
  FilmCategory,
  Address,
  City,
  Country,
  Outbox,
  SagaInstance,
];

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DB_HOST ?? 'localhost',
      port: Number(process.env.DB_PORT ?? 5433),
      username: process.env.DB_USER ?? 'pagila',
      password: process.env.DB_PASSWORD ?? 'pagila',
      database: process.env.DB_NAME ?? 'pagila',
      entities,
      synchronize: false, // innegociable con esquema legacy
      logging: ['query', 'error'],
    }),
    TypeOrmModule.forFeature(entities),
    ScheduleModule.forRoot(),
    SagaModule,
  ],
  controllers: [
    AppController,
    ActorController,
    FilmController,
    RentalController,
    HealthController,
    OutboxController,
  ],
  providers: [
    AppService,
    ActorService,
    FilmService,
    RentalService,
    OutboxRelayService,
    OutboxMetricsService,
    OutboxCleanup,
    RentalQueueService,
  ],
})
export class AppModule {}
