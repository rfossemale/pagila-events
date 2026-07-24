import { Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { Actor } from './actor.entity';
import { Film } from './film.entity';

@Entity({ name: 'film_actor' })
export class FilmActor {
  @PrimaryColumn({ name: 'actor_id', type: 'int' })
  actorId!: number;

  @PrimaryColumn({ name: 'film_id', type: 'int' })
  filmId!: number;

  // @Column({
  //   name: 'last_update',
  //   type: 'timestamptz',
  //   default: () => 'now()',
  // })
  // lastUpdate!: Date;

  @ManyToOne(() => Actor, (actor) => actor.filmActors, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'actor_id', referencedColumnName: 'actorId' })
  actor?: Actor;

  @ManyToOne(() => Film, (film) => film.filmActors, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'film_id', referencedColumnName: 'filmId' })
  film?: Film;
}
