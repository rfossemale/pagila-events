import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Address } from './address.entity';
import { Staff } from './staff.entity';
import { Customer } from './customer.entity';
import { Inventory } from './inventory.entity';

@Entity({ name: 'store' })
export class Store {
  @PrimaryGeneratedColumn({ name: 'store_id', type: 'int' })
  storeId!: number;

  @Column({ name: 'manager_staff_id', type: 'int' })
  managerStaffId!: number;

  @Column({ name: 'address_id', type: 'int' })
  addressId!: number;

  @Column({
    name: 'last_update',
    type: 'timestamptz',
    default: () => 'now()',
  })
  lastUpdate!: Date;

  @ManyToOne(() => Staff, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'manager_staff_id', referencedColumnName: 'staffId' })
  managerStaff?: Staff;

  @ManyToOne(() => Address, (address) => address.stores, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'address_id', referencedColumnName: 'addressId' })
  address?: Address;

  @OneToMany(() => Staff, (staff) => staff.store)
  staff?: Staff[];

  @OneToMany(() => Customer, (customer) => customer.store)
  customers?: Customer[];

  @OneToMany(() => Inventory, (inventory) => inventory.store)
  inventories?: Inventory[];
}
