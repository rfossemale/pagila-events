import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Film } from '../entities/film.entity';

@Injectable()
export class FilmService {
  constructor(
    @InjectRepository(Film)
    private readonly filmRepository: Repository<Film>,
  ) {}

  async getFilmByActor(actor: string): Promise<Film[]> {
    const result = await this.filmRepository
      .createQueryBuilder('film')
      .innerJoin('film.filmActors', 'filmActor')
      .innerJoin('filmActor.actor', 'actor')
      .where(
        'actor.firstName ilike :firstName OR actor.lastName ilike :lastName',
        {
          firstName: `%${actor}%`,
          lastName: `%${actor}%`,
        },
      )
      .getMany();
    return result;
  }
  //   return await this.filmRepository
  //     .createQueryBuilder('film')
  //     .innerJoin('film.filmActors', 'filmActor')
  //     .innerJoin('filmActor.actor', 'actor')
  //     //.where('actor.firstName = :firstName OR actor.lastName = :lastName', {
  //     .where('actor.firstName = :firstName', {
  //       firstName: actor,
  //       lastName: actor,
  //     })
  //     .getOne();
  // }
}
