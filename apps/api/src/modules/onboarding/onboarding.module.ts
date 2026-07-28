import { Module } from '@nestjs/common';
import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';
import { HerdModule } from '../herd/herd.module';

/**
 * Onboarding (O-3): los datos de ejemplo. Reusa `HerdModule` en vez de escribir animales por su
 * cuenta — el hato de muestra tiene que comportarse igual que uno real, porque es lo que el
 * productor está mirando para decidir si la app le sirve.
 */
@Module({
  imports: [HerdModule],
  controllers: [OnboardingController],
  providers: [OnboardingService],
})
export class OnboardingModule {}
