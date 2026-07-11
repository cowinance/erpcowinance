import { Global, Module } from '@nestjs/common';
import { EMAIL_SENDER } from '../../application/ports/email-sender.port';
import { LogEmailSender } from './log-email-sender';

/**
 * Infra de email (ADR-0011), `@Global` como `EventBusModule`: expone el puerto
 * `EMAIL_SENDER`; los servicios inyectan el puerto (token), nunca el adaptador
 * concreto. El adaptador se elige por `EMAIL_PROVIDER` (default `log`, mismo
 * estilo que `SEED_DEMO`); hoy solo existe el de desarrollo. Agregar
 * SMTP/SES/Resend = un adaptador nuevo en esta carpeta + un `case` aquí, sin
 * tocar `identity`. Falla ruidosamente si se pide un proveedor inexistente.
 */
@Global()
@Module({
  providers: [
    {
      provide: EMAIL_SENDER,
      useFactory: () => {
        const provider = process.env.EMAIL_PROVIDER?.trim().toLowerCase() || 'log';
        switch (provider) {
          case 'log':
            return new LogEmailSender();
          default:
            throw new Error(`EMAIL_PROVIDER desconocido: "${provider}". Adaptadores disponibles: log`);
        }
      },
    },
  ],
  exports: [EMAIL_SENDER],
})
export class EmailModule {}
