import { Column, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { FilmActor } from './film_actor.entity';

@Entity({ name: 'actor' })
export class Actor {
  @PrimaryGeneratedColumn({ name: 'actor_id', type: 'int' })
  actorId!: number;

  @Column({ name: 'first_name', type: 'text' })
  firstName!: string;

  @Column({ name: 'last_name', type: 'text' })
  lastName!: string;

  // @Column({
  //   name: 'last_update',
  //   type: 'timestamptz',
  //   default: () => 'now()',
  // })
  // lastUpdate!: Date;

  @OneToMany(() => FilmActor, (filmActor) => filmActor.actor)
  filmActors?: FilmActor[];
}
