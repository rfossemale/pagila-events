import { Controller, Get, Param } from '@nestjs/common';
import { ActorService } from '../services/actor.service';
import { Actor } from '../entities/actor.entity';

@Controller('actors')
export class ActorController {
  constructor(private readonly actorService: ActorService) {}

  @Get('/:id')
  async getActorById(@Param('id') id: number): Promise<Actor | null> {
    return this.actorService.getActorById(id);
  }
}
