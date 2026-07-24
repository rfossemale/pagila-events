import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InventoryAvailability } from './entities/inventory-availability.entity';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: 'localhost',
      port: 5433,
      username: 'pagila',
      password: 'pagila',
      database: 'pagila',
      entities: [InventoryAvailability],
      synchronize: false,
    }),
    TypeOrmModule.forFeature([InventoryAvailability]),
  ],
  controllers: [AppController],
  providers: [AppService],
  exports: [TypeOrmModule.forFeature([InventoryAvailability])],
})
export class AppModule {}
