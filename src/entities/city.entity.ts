import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Country } from './country.entity';
import { Address } from './address.entity';

@Entity({ name: 'city' })
export class City {
  @PrimaryGeneratedColumn({ name: 'city_id', type: 'int' })
  cityId!: number;

  @Column({ name: 'city', type: 'text' })
  city!: string;

  @Column({ name: 'country_id', type: 'int' })
  countryId!: number;

  @Column({
    name: 'last_update',
    type: 'timestamptz',
    default: () => 'now()',
  })
  lastUpdate!: Date;

  @ManyToOne(() => Country, (country) => country.cities, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'country_id', referencedColumnName: 'countryId' })
  country?: Country;

  @OneToMany(() => Address, (address) => address.city)
  addresses?: Address[];
}
