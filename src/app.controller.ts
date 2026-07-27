import { Controller, Get, Post, Body } from '@nestjs/common';
import { AppService } from './app.service';
import type { IncomingEvent } from './types/index';
import { EventProcessorService } from './services/event-processor.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly processor: EventProcessorService,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Post('events')
  async handle(@Body() evt: IncomingEvent) {
    await this.processor.process(evt);
    return { ok: true };
  }
}
