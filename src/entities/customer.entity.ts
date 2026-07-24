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

@Entity({ name: 'customer' })
export class Customer {
  @PrimaryGeneratedColumn({ name: 'customer_id', type: 'int' })
  customerId!: number;

  @Column({ name: 'store_id', type: 'int' })
  storeId!: number;

  @Column({ name: 'first_name', type: 'text' })
  firstName!: string;

  @Column({ name: 'last_name', type: 'text' })
  lastName!: string;

  @Column({ name: 'email', type: 'text', nullable: true })
  email?: string | null;

  @Column({ name: 'address_id', type: 'int' })
  addressId!: number;

  @Column({ name: 'activebool', type: 'bool', default: true })
  activebool!: boolean;

  @Column({ name: 'create_date', type: 'date', default: () => 'CURRENT_DATE' })
  createDate!: Date;

  @Column({
    name: 'last_update',
    type: 'timestamptz',
    nullable: true,
    default: () => 'now()',
  })
  lastUpdate?: Date | null;

  @Column({ name: 'active', type: 'int', nullable: true })
  active?: number | null;

  @ManyToOne(() => Store, (store) => store.customers, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'store_id', referencedColumnName: 'storeId' })
  store?: Store;

  @ManyToOne(() => Address, (address) => address.customers, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'address_id', referencedColumnName: 'addressId' })
  address?: Address;

  @OneToMany(() => Rental, (rental) => rental.customer)
  rentals?: Rental[];

  @OneToMany(() => Payment, (payment) => payment.customer)
  payments?: Payment[];
}
