import {
  Column,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { City } from './city.entity';

@Entity({ name: 'country' })
export class Country {
  @PrimaryGeneratedColumn({ name: 'country_id', type: 'int' })
  countryId!: number;

  @Column({ name: 'country', type: 'text' })
  country!: string;

  @Column({
    name: 'last_update',
    type: 'timestamptz',
    default: () => 'now()',
  })
  lastUpdate!: Date;

  @OneToMany(() => City, (city) => city.country)
  cities?: City[];
}
