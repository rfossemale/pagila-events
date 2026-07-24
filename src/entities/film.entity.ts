import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { FilmActor } from './film_actor.entity';
import { MpaaRating } from './mpaa-rating.enum';
import { Inventory } from './inventory.entity';
import { Language } from './language.entity';
import { FilmCategory } from './film_category.entity';

@Entity({ name: 'film' })
export class Film {
  @PrimaryGeneratedColumn({ name: 'film_id', type: 'int' })
  filmId!: number;

  @Column({ name: 'title', type: 'text' })
  title!: string;

  @Column({ name: 'description', type: 'text', nullable: true })
  description?: string | null;

  // Dominio public.year (integer con CHECK 1901..2155)
  @Column({ name: 'release_year', type: 'int', nullable: true })
  releaseYear?: number | null;

  @Column({ name: 'language_id', type: 'int' })
  languageId!: number;

  @Column({ name: 'original_language_id', type: 'int', nullable: true })
  originalLanguageId?: number | null;

  @Column({ name: 'rental_duration', type: 'smallint', default: 3 })
  rentalDuration!: number;

  @Column({
    name: 'rental_rate',
    type: 'numeric',
    precision: 4,
    scale: 2,
    default: 4.99,
    transformer: {
      to: (value?: number) => value,
      from: (value?: string) => (value == null ? value : parseFloat(value)),
    },
  })
  rentalRate!: number;

  @Column({ name: 'length', type: 'smallint', nullable: true })
  length?: number | null;

  @Column({
    name: 'replacement_cost',
    type: 'numeric',
    precision: 5,
    scale: 2,
    default: 19.99,
    transformer: {
      to: (value?: number) => value,
      from: (value?: string) => (value == null ? value : parseFloat(value)),
    },
  })
  replacementCost!: number;

  @Column({
    name: 'rating',
    type: 'enum',
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    enum: MpaaRating,
    enumName: 'mpaa_rating',
    nullable: true,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
    default: MpaaRating.G,
  })
  rating?: MpaaRating | null;

  // @Column({
  //   name: 'last_update',
  //   type: 'timestamptz',
  //   default: () => 'now()',
  // })
  // lastUpdate!: Date;

  @Column({
    name: 'special_features',
    type: 'text',
    array: true,
    nullable: true,
  })
  specialFeatures?: string[] | null;

  // @Column({ name: 'fulltext', type: 'tsvector' })
  // fulltext!: string;

  @OneToMany(() => FilmActor, (filmActor) => filmActor.film)
  filmActors?: FilmActor[];

  @OneToMany(() => Inventory, (inventory) => inventory.film)
  inventories?: Inventory[];

  @OneToMany(() => FilmCategory, (filmCategory) => filmCategory.film)
  filmCategories?: FilmCategory[];

  @ManyToOne(() => Language, (language) => language.films, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'language_id', referencedColumnName: 'languageId' })
  language?: Language;

  @ManyToOne(() => Language, (language) => language.originalLanguageFilms, {
    onDelete: 'RESTRICT',
    nullable: true,
  })
  @JoinColumn({
    name: 'original_language_id',
    referencedColumnName: 'languageId',
  })
  originalLanguage?: Language | null;
}
