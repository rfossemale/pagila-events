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
import { ScheduleModule } from '@nestjs/schedule';

import { ActorController } from './controllers/actor.controller';
import { ActorService } from './services/actor.service';
import { FilmController } from './controllers/films.controllers';
import { FilmService } from './services/film.service';
import { RentalController } from './controllers/rental.controller';
import { RentalService } from './services/rental.service';
import { OutboxRelayService } from './services/relay/outbox-relay.service';

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
];

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: 'localhost',
      port: 5433,
      username: 'pagila',
      password: 'pagila',
      database: 'pagila',
      entities,
      synchronize: false, // innegociable con esquema legacy
      logging: ['query', 'error'],
    }),
    TypeOrmModule.forFeature(entities),
    ScheduleModule.forRoot(),
  ],
  controllers: [
    AppController,
    ActorController,
    FilmController,
    RentalController,
  ],
  providers: [
    AppService,
    ActorService,
    FilmService,
    RentalService,
    OutboxRelayService,
  ],
})
export class AppModule {}
