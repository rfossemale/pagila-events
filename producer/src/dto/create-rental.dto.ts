export class CreateRentalDto {
  filmId!: number;
  storeId!: number;
  customerId!: number;
  staffId!: number;
}

export interface CreateRentalResult {
  rentalId: number;
  inventoryId: number;
  paymentId: number;
  amount: number;
  rentalDate: Date;
}

export interface ReturnRentalResult {
  rentalId: number;
  inventoryId: number;
  filmId: number;
  storeId: number;
  returnDate: Date;
}
