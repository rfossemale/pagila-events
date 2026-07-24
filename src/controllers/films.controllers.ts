import { Controller, Get, Query } from '@nestjs/common';
import { FilmService } from '../services/film.service';
import { Film } from '../entities/film.entity';

@Controller('films')
export class FilmController {
  constructor(private readonly filmService: FilmService) {}

  @Get()
  async getFilmById(@Query('actor') actor: string): Promise<Film[]> {
    return this.filmService.getFilmByActor(actor);
  }
}
