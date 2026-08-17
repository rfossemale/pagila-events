import {
  Body,
  Controller,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import { RentalService } from '../services/rental.service';
import {
  CreateRentalDto,
  CreateRentalResult,
  ReturnRentalResult,
} from '../dto/create-rental.dto';

@Controller('rentals')
export class RentalController {
  constructor(private readonly rentalService: RentalService) {}

  @Post()
  @HttpCode(201)
  async createRental(
    @Body() body: CreateRentalDto,
  ): Promise<CreateRentalResult> {
    return this.rentalService.createRental(body);
  }

  @Post(':rentalId/return')
  @HttpCode(200)
  async returnRental(
    @Param('rentalId', ParseIntPipe) rentalId: number,
  ): Promise<ReturnRentalResult> {
    return this.rentalService.returnRental(rentalId);
  }
}
