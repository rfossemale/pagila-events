import {
  Column,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { FilmCategory } from './film_category.entity';

@Entity({ name: 'category' })
export class Category {
  @PrimaryGeneratedColumn({ name: 'category_id', type: 'int' })
  categoryId!: number;

  @Column({ name: 'name', type: 'text' })
  name!: string;

  @Column({
    name: 'last_update',
    type: 'timestamptz',
    default: () => 'now()',
  })
  lastUpdate!: Date;

  @OneToMany(() => FilmCategory, (filmCategory) => filmCategory.category)
  filmCategories?: FilmCategory[];
}
