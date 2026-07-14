import { Module } from '@nestjs/common';
import { AgricultureController } from './agriculture.controller';
import { CropsService } from './crops.service';

/**
 * Agricultura (AG-1): cultivos sobre paddocks. Bounded context propio. Las labores (consumo de
 * insumos, AG-2) reusarán InventoryService.recordMovementInTx.
 */
@Module({
  controllers: [AgricultureController],
  providers: [CropsService],
})
export class AgricultureModule {}
