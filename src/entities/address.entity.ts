import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { City } from './city.entity';
import { Customer } from './customer.entity';
import { Staff } from './staff.entity';
import { Store } from './store.entity';

@Entity({ name: 'address' })
export class Address {
  @PrimaryGeneratedColumn({ name: 'address_id', type: 'int' })
  addressId!: number;

  @Column({ name: 'address', type: 'text' })
  address!: string;

  @Column({ name: 'address2', type: 'text', nullable: true })
  address2?: string | null;

  @Column({ name: 'district', type: 'text' })
  district!: string;

  @Column({ name: 'city_id', type: 'int' })
  cityId!: number;

  @Column({ name: 'postal_code', type: 'text', nullable: true })
  postalCode?: string | null;

  @Column({ name: 'phone', type: 'text' })
  phone!: string;

  @Column({
    name: 'last_update',
    type: 'timestamptz',
    default: () => 'now()',
  })
  lastUpdate!: Date;

  @ManyToOne(() => City, (city) => city.addresses, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'city_id', referencedColumnName: 'cityId' })
  city?: City;

  @OneToMany(() => Customer, (customer) => customer.address)
  customers?: Customer[];

  @OneToMany(() => Staff, (staff) => staff.address)
  staff?: Staff[];

  @OneToMany(() => Store, (store) => store.address)
  stores?: Store[];
}
