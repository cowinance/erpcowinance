import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { InventoryService } from './inventory.service';

@Controller('inventory')
export class InventoryController {
  constructor(private readonly inv: InventoryService) {}

  @Get('units')
  units() {
    return this.inv.listUnits();
  }

  @Get('categories')
  categories() {
    return this.inv.listCategories();
  }
  @Post('categories')
  createCategory(@Body() body: any) {
    return this.inv.createCategory(body);
  }
  @Patch('categories/:id')
  updateCategory(@Param('id') id: string, @Body() body: any) {
    return this.inv.updateCategory(id, body);
  }
  @Delete('categories/:id')
  deleteCategory(@Param('id') id: string) {
    return this.inv.deleteCategory(id);
  }

  @Get('items')
  items() {
    return this.inv.listItems();
  }
  @Post('items')
  createItem(@Body() body: any) {
    return this.inv.createItem(body);
  }
  @Patch('items/:id')
  updateItem(@Param('id') id: string, @Body() body: any) {
    return this.inv.updateItem(id, body);
  }
  @Delete('items/:id')
  deleteItem(@Param('id') id: string) {
    return this.inv.deleteItem(id);
  }

  @Get('warehouses')
  warehouses() {
    return this.inv.listWarehouses();
  }

  @Post('movements')
  recordMovement(@Body() body: any) {
    return this.inv.recordMovement(body);
  }
  @Get('movements')
  movements(@Query('item_id') itemId?: string, @Query('warehouse_id') warehouseId?: string) {
    return this.inv.listMovements(itemId, warehouseId);
  }
  @Get('stock')
  stock(@Query('warehouse_id') warehouseId?: string, @Query('item_id') itemId?: string) {
    return this.inv.listStock(warehouseId, itemId);
  }
  @Post('warehouses')
  createWarehouse(@Body() body: any) {
    return this.inv.createWarehouse(body);
  }
  @Patch('warehouses/:id')
  updateWarehouse(@Param('id') id: string, @Body() body: any) {
    return this.inv.updateWarehouse(id, body);
  }
  @Delete('warehouses/:id')
  deleteWarehouse(@Param('id') id: string) {
    return this.inv.deleteWarehouse(id);
  }
}
