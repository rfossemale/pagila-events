import { Controller, Get, Post, Body } from '@nestjs/common';
import { AppService } from './app.service';
import { Repository } from 'typeorm';
import { InventoryAvailability } from './entities/inventory-availability.entity';
import type { IncomingEvent } from './types/index';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly repo: Repository<InventoryAvailability>,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Post('events')
  async handle(@Body() evt: IncomingEvent) {
    if (evt.eventType === 'RentalStarted') {
      const { filmId, storeId } = evt.payload;
      await this.repo.decrement({ filmId, storeId }, 'available', 1);
      // throw new Error('boom');   // el relay verá 500 y reintentará
    }
    return { ok: true };
  }
}
