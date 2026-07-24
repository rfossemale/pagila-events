import {
  Column,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Film } from './film.entity';

@Entity({ name: 'language' })
export class Language {
  @PrimaryGeneratedColumn({ name: 'language_id', type: 'int' })
  languageId!: number;

  @Column({ name: 'name', type: 'char', length: 20 })
  name!: string;

  @Column({
    name: 'last_update',
    type: 'timestamptz',
    default: () => 'now()',
  })
  lastUpdate!: Date;

  @OneToMany(() => Film, (film) => film.language)
  films?: Film[];

  @OneToMany(() => Film, (film) => film.originalLanguage)
  originalLanguageFilms?: Film[];
}
