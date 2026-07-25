import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { CryoStorageService } from './cryo-storage.service';

/**
 * Termos, canastas y gobeletes (GT-1).
 *
 * Las canastas cuelgan del termo y los gobeletes de la canasta al CREARLOS —es donde el padre es
 * obligatorio— pero se editan y se borran por su propio id: una vez que existen, ya se sabe dónde
 * están y repetir el camino entero solo daría más formas de escribir la misma URL.
 */
@Controller('genetics/cryo')
export class CryoStorageController {
  constructor(private readonly cryo: CryoStorageService) {}

  @Get('tanks')
  listTanks() {
    return this.cryo.listTanks();
  }
  @Get('tanks/:id')
  getTank(@Param('id') id: string) {
    return this.cryo.getTank(id);
  }
  @Post('tanks')
  createTank(@Body() body: any) {
    return this.cryo.createTank(body);
  }
  @Patch('tanks/:id')
  updateTank(@Param('id') id: string, @Body() body: any) {
    return this.cryo.updateTank(id, body);
  }
  @Delete('tanks/:id')
  deleteTank(@Param('id') id: string) {
    return this.cryo.deleteTank(id);
  }

  @Post('tanks/:id/canisters')
  createCanister(@Param('id') tankId: string, @Body() body: any) {
    return this.cryo.createCanister(tankId, body);
  }
  @Patch('canisters/:id')
  updateCanister(@Param('id') id: string, @Body() body: any) {
    return this.cryo.updateCanister(id, body);
  }
  @Delete('canisters/:id')
  deleteCanister(@Param('id') id: string) {
    return this.cryo.deleteCanister(id);
  }

  @Post('canisters/:id/goblets')
  createGoblet(@Param('id') canisterId: string, @Body() body: any) {
    return this.cryo.createGoblet(canisterId, body);
  }
  @Patch('goblets/:id')
  updateGoblet(@Param('id') id: string, @Body() body: any) {
    return this.cryo.updateGoblet(id, body);
  }
  @Delete('goblets/:id')
  deleteGoblet(@Param('id') id: string) {
    return this.cryo.deleteGoblet(id);
  }
}
