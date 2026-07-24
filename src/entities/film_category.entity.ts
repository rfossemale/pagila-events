import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { Film } from './film.entity';
import { Category } from './category.entity';

@Entity({ name: 'film_category' })
export class FilmCategory {
  @PrimaryColumn({ name: 'film_id', type: 'int' })
  filmId!: number;

  @PrimaryColumn({ name: 'category_id', type: 'int' })
  categoryId!: number;

  @Column({
    name: 'last_update',
    type: 'timestamptz',
    default: () => 'now()',
  })
  lastUpdate!: Date;

  @ManyToOne(() => Film, (film) => film.filmCategories, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'film_id', referencedColumnName: 'filmId' })
  film?: Film;

  @ManyToOne(() => Category, (category) => category.filmCategories, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'category_id', referencedColumnName: 'categoryId' })
  category?: Category;
}
