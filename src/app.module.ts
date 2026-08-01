import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InventoryAvailability } from './entities/inventory-availability.entity';
import { AggregateVersion } from './entities/aggregate-version.entity';
import { ProcessedEvent } from './entities/processed-event.entity';
import { EventProcessorService } from './services/event-processor.service';
import { RentalWorkerService } from './queues/rental-worker.service';
import { SagaModule } from './saga/saga.module';

const entities = [InventoryAvailability, AggregateVersion, ProcessedEvent];

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
      synchronize: false,
    }),
    TypeOrmModule.forFeature(entities),
    SagaModule,
  ],
  controllers: [AppController],
  providers: [AppService, EventProcessorService, RentalWorkerService],
})
export class AppModule {}
