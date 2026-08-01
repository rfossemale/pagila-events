import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { SagaInstance } from '../entities/saga-instance.entity';
import { RentalSagaOrchestrator } from '../services/rental-saga.orchestrator';
import { CreateRentalDto } from '../../dto/create-rental.dto';

/**
 * Endpoints de la implementación Saga (educativa).
 * Coexiste con el endpoint clásico `POST /rentals` (outbox-based).
 */
@Controller('sagas/rentals')
export class SagaRentalController {
  constructor(
    private readonly orchestrator: RentalSagaOrchestrator,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  @Post()
  @HttpCode(202)
  start(@Body() body: CreateRentalDto) {
    return this.orchestrator.start(body);
  }

  @Get(':sagaId')
  async status(@Param('sagaId') sagaId: string) {
    const saga = await this.dataSource
      .getRepository(SagaInstance)
      .findOne({ where: { id: sagaId } });
    return saga;
  }
}
