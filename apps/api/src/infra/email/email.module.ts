import { Global, Logger, Module } from '@nestjs/common';
import { EMAIL_SENDER } from '../../application/ports/email-sender.port';
import { LogEmailSender } from './log-email-sender';
import { SmtpEmailSender, smtpConfigFromEnv } from './smtp-email-sender';

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
        const logger = new Logger('EmailSender');
        switch (provider) {
          case 'log':
            // En producción esto NO es un adaptador válido: el correo se imprime al log y el
            // usuario nunca recibe el link de verificación ni el de reset. Se avisa fuerte en
            // vez de fallar, para no dejar sin arrancar a un despliegue que todavía no configuró
            // el SMTP — pero la advertencia dice exactamente qué queda roto.
            if (process.env.NODE_ENV === 'production')
              logger.warn(
                'EMAIL_PROVIDER=log en producción: los emails se IMPRIMEN, no se envían. La ' +
                  'verificación de email y el reset de contraseña quedan sin efecto para el usuario. ' +
                  'Configurá EMAIL_PROVIDER=smtp.',
              );
            return new LogEmailSender();
          case 'smtp': {
            const config = smtpConfigFromEnv();
            logger.log(`Email: SMTP (${config.host}:${config.port}, from ${config.from})`);
            return new SmtpEmailSender(config);
          }
          default:
            throw new Error(`EMAIL_PROVIDER desconocido: "${provider}". Adaptadores disponibles: log, smtp`);
        }
      },
    },
  ],
  exports: [EMAIL_SENDER],
})
export class EmailModule {}
