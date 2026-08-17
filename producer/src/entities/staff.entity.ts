import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Address } from './address.entity';
import { Store } from './store.entity';
import { Rental } from './rental.entity';
import { Payment } from './payment.entity';

@Entity({ name: 'staff' })
export class Staff {
  @PrimaryGeneratedColumn({ name: 'staff_id', type: 'int' })
  staffId!: number;

  @Column({ name: 'first_name', type: 'text' })
  firstName!: string;

  @Column({ name: 'last_name', type: 'text' })
  lastName!: string;

  @Column({ name: 'address_id', type: 'int' })
  addressId!: number;

  @Column({ name: 'email', type: 'text', nullable: true })
  email?: string | null;

  @Column({ name: 'store_id', type: 'int' })
  storeId!: number;

  @Column({ name: 'active', type: 'bool', default: true })
  active!: boolean;

  @Column({ name: 'username', type: 'text' })
  username!: string;

  @Column({ name: 'password', type: 'text', nullable: true })
  password?: string | null;

  @Column({
    name: 'last_update',
    type: 'timestamptz',
    default: () => 'now()',
  })
  lastUpdate!: Date;

  @Column({ name: 'picture', type: 'bytea', nullable: true })
  picture?: Buffer | null;

  @ManyToOne(() => Address, (address) => address.staff, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'address_id', referencedColumnName: 'addressId' })
  address?: Address;

  @ManyToOne(() => Store, (store) => store.staff, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'store_id', referencedColumnName: 'storeId' })
  store?: Store;

  @OneToMany(() => Rental, (rental) => rental.staff)
  rentals?: Rental[];

  @OneToMany(() => Payment, (payment) => payment.staff)
  payments?: Payment[];
}
